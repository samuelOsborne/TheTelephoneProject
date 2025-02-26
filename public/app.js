// App state
const state = {
  registered: false,
  phoneNumber: null,
  isPublic: false,
  connection: null,
  peerConnection: null,
  localStream: null,
  remoteStream: null,
  currentCall: {
    active: false,
    with: null,
    startTime: null,
    timerInterval: null,
    muted: false
  },
  incomingCall: {
    from: null,
    sdpOffer: null
  }
};

// DOM Elements
const elements = {
  statusIndicator: document.getElementById('status-indicator'),
  registrationSection: document.getElementById('registration-section'),
  dialerSection: document.getElementById('dialer-section'),
  callSection: document.getElementById('call-section'),
  incomingCallSection: document.getElementById('incoming-call-section'),
  phoneNumberInput: document.getElementById('phone-number-input'),
  registerBtn: document.getElementById('register-btn'),
  publicListingCheckbox: document.getElementById('public-listing-checkbox'),
  currentNumber: document.getElementById('current-number'),
  targetNumberInput: document.getElementById('target-number-input'),
  callBtn: document.getElementById('call-btn'),
  refreshListingsBtn: document.getElementById('refresh-listings-btn'),
  publicNumbersList: document.getElementById('public-numbers-list'),
  callStatus: document.getElementById('call-status'),
  callNumber: document.getElementById('call-number'),
  callTime: document.getElementById('call-time'),
  endCallBtn: document.getElementById('end-call-btn'),
  muteBtn: document.getElementById('mute-btn'),
  callerNumber: document.getElementById('caller-number'),
  acceptCallBtn: document.getElementById('accept-call-btn'),
  rejectCallBtn: document.getElementById('reject-call-btn'),
  ringtone: document.getElementById('ringtone')
};

// Initialize SockJS connection
function initConnection() {
  // Create a new SockJS connection to the server
  const socket = new SockJS('/socket');
  
  socket.onopen = function() {
    console.log('Connected to server');
    updateStatus('Connected', true);
    state.connection = socket;
  };
  
  socket.onmessage = function(e) {
    const data = JSON.parse(e.data);
    handleServerMessage(data);
  };
  
  socket.onclose = function() {
    console.log('Disconnected from server');
    updateStatus('Offline', false);
    state.connection = null;
    state.registered = false;
    showSection('registration');
  };
}

// Send message to server
function sendToServer(message) {
  if (state.connection && state.connection.readyState === SockJS.OPEN) {
    state.connection.send(JSON.stringify(message));
  } else {
    console.error('No connection to server');
    alert('Connection lost. Please refresh the page.');
  }
}

// Handle messages from server
function handleServerMessage(data) {
  console.log('Received message:', data);
  
  switch (data.type) {
    case 'registration_success':
      state.registered = true;
      state.phoneNumber = data.phoneNumber;
      elements.currentNumber.textContent = state.phoneNumber;
      showSection('dialer');
      updatePublicListing();
      break;
      
    case 'registration_failed':
      alert(data.message);
      break;
      
    case 'public_status_updated':
      state.isPublic = data.isPublic;
      break;
      
    case 'public_listings':
      updatePublicListingsUI(data.listings);
      break;
      
    case 'incoming_call':
      handleIncomingCall(data);
      break;
      
    case 'call_answered':
      handleCallAnswered(data);
      break;
      
    case 'call_failed':
      alert(data.message);
      resetCallState();
      break;
      
    case 'ice_candidate':
      handleIceCandidate(data);
      break;
      
    case 'call_ended':
      alert(`Call ended by ${data.by}`);
      endCall();
      break;
      
    case 'error':
      console.error('Server error:', data.message);
      alert(`Error: ${data.message}`);
      break;
      
    default:
      console.log('Unhandled message type:', data.type);
  }
}

// Update status indicator
function updateStatus(text, isOnline) {
  elements.statusIndicator.textContent = text;
  elements.statusIndicator.className = `status ${isOnline ? 'online' : 'offline'}`;
}

// Show a specific section and hide others
function showSection(sectionName) {
  elements.registrationSection.classList.add('hidden');
  elements.dialerSection.classList.add('hidden');
  elements.callSection.classList.add('hidden');
  elements.incomingCallSection.classList.add('hidden');
  
  switch (sectionName) {
    case 'registration':
      elements.registrationSection.classList.remove('hidden');
      break;
    case 'dialer':
      elements.dialerSection.classList.remove('hidden');
      break;
    case 'call':
      elements.callSection.classList.remove('hidden');
      break;
    case 'incoming':
      elements.incomingCallSection.classList.remove('hidden');
      break;
  }
}

// Register phone number
function registerPhoneNumber() {
  const phoneNumber = elements.phoneNumberInput.value.trim();
  
  if (!phoneNumber) {
    alert('Please enter a phone number');
    return;
  }
  
  sendToServer({
    type: 'register',
    phoneNumber: phoneNumber
  });
}

// Update public listing status
function updatePublicListing() {
  const isPublic = elements.publicListingCheckbox.checked;
  
  sendToServer({
    type: 'set_public',
    isPublic: isPublic
  });
  
  state.isPublic = isPublic;
}

// Request public listings
function requestPublicListings() {
  sendToServer({ type: 'get_public_listings' });
}

// Update public listings UI
function updatePublicListingsUI(listings) {
  const listElement = elements.publicNumbersList;
  listElement.innerHTML = '';
  
  if (listings.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No public numbers available';
    listElement.appendChild(li);
    return;
  }
  
  listings.forEach(number => {
    if (number !== state.phoneNumber) {
      const li = document.createElement('li');
      li.textContent = number;
      li.addEventListener('click', () => {
        elements.targetNumberInput.value = number;
      });
      listElement.appendChild(li);
    }
  });
}

// Initialize WebRTC peer connection
function initPeerConnection() {
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };
  
  state.peerConnection = new RTCPeerConnection(configuration);
  
  // Add local stream to peer connection
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => {
      state.peerConnection.addTrack(track, state.localStream);
    });
  }
  
  // Set up event handlers for the peer connection
  state.peerConnection.onicecandidate = event => {
    if (event.candidate) {
      sendToServer({
        type: 'ice_candidate',
        targetPhoneNumber: state.currentCall.with,
        candidate: event.candidate
      });
    }
  };
  
  state.peerConnection.ontrack = event => {
    state.remoteStream = event.streams[0];
    const remoteAudio = new Audio();
    remoteAudio.srcObject = state.remoteStream;
    remoteAudio.autoplay = true;
  };
}

// Request user media (microphone)
async function requestUserMedia() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    state.localStream = stream;
    return true;
  } catch (error) {
    console.error('Error accessing media devices:', error);
    alert('Could not access microphone. Please check permissions.');
    return false;
  }
}

// Make a call
async function makeCall() {
  const targetNumber = elements.targetNumberInput.value.trim();
  
  if (!targetNumber) {
    alert('Please enter a number to call');
    return;
  }
  
  if (targetNumber === state.phoneNumber) {
    alert('You cannot call yourself');
    return;
  }
  
  // Request microphone access
  if (!state.localStream) {
    const mediaAccess = await requestUserMedia();
    if (!mediaAccess) return;
  }
  
  // Initialize peer connection for the call
  initPeerConnection();
  
  // Create an offer
  try {
    const offer = await state.peerConnection.createOffer({
      offerToReceiveAudio: true
    });
    
    await state.peerConnection.setLocalDescription(offer);
    
    // Send the offer to the server
    sendToServer({
      type: 'call_request',
      targetPhoneNumber: targetNumber,
      sdpOffer: offer
    });
    
    // Update UI
    state.currentCall.with = targetNumber;
    elements.callNumber.textContent = targetNumber;
    elements.callStatus.textContent = 'Calling...';
    showSection('call');
    
  } catch (error) {
    console.error('Error creating offer:', error);
    alert('Error making call. Please try again.');
  }
}

// Handle incoming call
function handleIncomingCall(data) {
  state.incomingCall.from = data.from;
  state.incomingCall.sdpOffer = data.sdpOffer;
  
  elements.callerNumber.textContent = data.from;
  showSection('incoming');
  
  // Play ringtone
  elements.ringtone.play().catch(e => console.log('Could not play ringtone', e));
}

// Accept incoming call
async function acceptCall() {
  // Stop ringtone
  elements.ringtone.pause();
  elements.ringtone.currentTime = 0;
  
  // Request microphone access if not already granted
  if (!state.localStream) {
    const mediaAccess = await requestUserMedia();
    if (!mediaAccess) {
      rejectCall();
      return;
    }
  }
  
  // Initialize peer connection
  initPeerConnection();
  
  try {
    // Set remote description (the offer from the caller)
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(state.incomingCall.sdpOffer));
    
    // Create an answer
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);
    
    // Send the answer to the server
    sendToServer({
      type: 'call_response',
      callerPhoneNumber: state.incomingCall.from,
      accepted: true,
      sdpAnswer: answer
    });
    
    // Update UI and state
    state.currentCall.active = true;
    state.currentCall.with = state.incomingCall.from;
    startCallTimer();
    
    elements.callNumber.textContent = state.incomingCall.from;
    elements.callStatus.textContent = 'In call';
    showSection('call');
    
  } catch (error) {
    console.error('Error accepting call:', error);
    alert('Error accepting call. Please try again.');
    rejectCall();
  }
}

// Reject incoming call
function rejectCall() {
  // Stop ringtone
  elements.ringtone.pause();
  elements.ringtone.currentTime = 0;
  
  sendToServer({
    type: 'call_response',
    callerPhoneNumber: state.incomingCall.from,
    accepted: false
  });
  
  // Reset state
  state.incomingCall.from = null;
  state.incomingCall.sdpOffer = null;
  
  showSection('dialer');
}

// Handle call answered message
async function handleCallAnswered(data) {
  if (!data.accepted) {
    alert(`Call rejected by ${data.by}`);
    resetCallState();
    showSection('dialer');
    return;
  }
  
  try {
    // Set remote description (the answer from the callee)
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdpAnswer));
    
    // Update UI and state
    state.currentCall.active = true;
    startCallTimer();
    
    elements.callStatus.textContent = 'In call';
    
  } catch (error) {
    console.error('Error handling call answer:', error);
    alert('Error establishing call. Please try again.');
    endCall();
  }
}

// Handle ICE candidate from remote peer
async function handleIceCandidate(data) {
  try {
    if (state.peerConnection) {
      await state.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
  }
}

// Start call timer
function startCallTimer() {
  state.currentCall.startTime = new Date();
  elements.callTime.classList.remove('hidden');
  
  // Clear any existing timer
  if (state.currentCall.timerInterval) {
    clearInterval(state.currentCall.timerInterval);
  }
  
  // Update timer every second
  state.currentCall.timerInterval = setInterval(() => {
    const now = new Date();
    const diff = now - state.currentCall.startTime;
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    
    elements.callTime.textContent = 
      `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, 1000);
}

// Toggle mute
function toggleMute() {
  if (state.localStream) {
    const audioTracks = state.localStream.getAudioTracks();
    
    audioTracks.forEach(track => {
      track.enabled = !track.enabled;
    });
    
    state.currentCall.muted = !state.currentCall.muted;
    elements.muteBtn.textContent = state.currentCall.muted ? 'Unmute' : 'Mute';
  }
}

// End current call
function endCall() {
  if (state.currentCall.with) {
    sendToServer({
      type: 'end_call',
      targetPhoneNumber: state.currentCall.with
    });
  }
  
  resetCallState();
  showSection('dialer');
}

// Reset call state
function resetCallState() {
  // Clear timer
  if (state.currentCall.timerInterval) {
    clearInterval(state.currentCall.timerInterval);
  }
  
  // Close peer connection
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }
  
  // Reset call state
  state.currentCall.active = false;
  state.currentCall.with = null;
  state.currentCall.startTime = null;
  state.currentCall.timerInterval = null;
  state.currentCall.muted = false;
  
  // Update UI
  elements.callTime.classList.add('hidden');
  elements.muteBtn.textContent = 'Mute';
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Initialize connection
  initConnection();
  
  // Register button click
  elements.registerBtn.addEventListener('click', registerPhoneNumber);
  
  // Public listing checkbox change
  elements.publicListingCheckbox.addEventListener('change', updatePublicListing);
  
  // Call button click
  elements.callBtn.addEventListener('click', makeCall);
  
  // Refresh listings button click
  elements.refreshListingsBtn.addEventListener('click', requestPublicListings);
  
  // End call button click
  elements.endCallBtn.addEventListener('click', endCall);
  
  // Mute button click
  elements.muteBtn.addEventListener('click', toggleMute);
  
  // Accept call button click
  elements.acceptCallBtn.addEventListener('click', acceptCall);
  
  // Reject call button click
  elements.rejectCallBtn.addEventListener('click', rejectCall);
});
