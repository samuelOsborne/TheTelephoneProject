// server.js
const express = require('express');
const http = require('http');
const sockjs = require('sockjs');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Create a SockJS server
const sockjsServer = sockjs.createServer({
  prefix: '/socket',
  log: function(severity, message) {
    console.log(severity + ': ' + message);
  }
});

// User storage - maps phone numbers to connection IDs and vice versa
const users = new Map(); // phoneNumber -> connectionId
const connections = new Map(); // connectionId -> { phoneNumber, conn }
const publicListings = new Set(); // Set of phoneNumbers that are publicly listed

// Handle new SockJS connections
sockjsServer.on('connection', function(conn) {
  console.log('New connection:', conn.id);
  
  connections.set(conn.id, { conn });

  // Handle incoming messages
  conn.on('data', function(message) {
    try {
      const data = JSON.parse(message);
      handleMessage(conn, data);
    } catch (error) {
      console.error('Error parsing message:', error);
      sendToConnection(conn, { type: 'error', message: 'Invalid message format' });
    }
  });

  // Handle closed connections
  conn.on('close', function() {
    const connData = connections.get(conn.id);
    if (connData && connData.phoneNumber) {
      users.delete(connData.phoneNumber);
      publicListings.delete(connData.phoneNumber);
      
      // Notify other users that this user is offline
      broadcastUserStatusChange(connData.phoneNumber, false);
    }
    connections.delete(conn.id);
    console.log('Connection closed:', conn.id);
  });
});

// Message handler function
function handleMessage(conn, data) {
  const connId = conn.id;
  const connData = connections.get(connId);

  console.log('Received message type:', data.type);

  switch (data.type) {
    case 'register':
      // User wants to register a phone number
      const phoneNumber = data.phoneNumber;
      
      // Check if phone number is already registered
      if (users.has(phoneNumber)) {
        sendToConnection(conn, { 
          type: 'registration_failed', 
          message: 'Phone number already in use' 
        });
        return;
      }
      
      // Register the phone number
      users.set(phoneNumber, connId);
      connections.set(connId, { ...connData, phoneNumber });
      
      sendToConnection(conn, { 
        type: 'registration_success', 
        phoneNumber 
      });
      
      // Broadcast to all users that a new user is online
      broadcastUserStatusChange(phoneNumber, true);
      break;

    case 'set_public':
      // User wants to make their number public or private
      if (!connData.phoneNumber) {
        sendToConnection(conn, { 
          type: 'error', 
          message: 'Not registered with a phone number' 
        });
        return;
      }
      
      if (data.isPublic) {
        publicListings.add(connData.phoneNumber);
      } else {
        publicListings.delete(connData.phoneNumber);
      }
      
      sendToConnection(conn, { 
        type: 'public_status_updated', 
        isPublic: data.isPublic 
      });
      break;

    case 'get_public_listings':
      // User wants to get all public phone numbers
      sendToConnection(conn, { 
        type: 'public_listings', 
        listings: Array.from(publicListings) 
      });
      break;

    case 'call_request':
      // User wants to call another user
      const targetPhoneNumber = data.targetPhoneNumber;
      
      if (!connData.phoneNumber) {
        sendToConnection(conn, { 
          type: 'error', 
          message: 'Not registered with a phone number' 
        });
        return;
      }
      
      const targetConnId = users.get(targetPhoneNumber);
      if (!targetConnId) {
        sendToConnection(conn, { 
          type: 'call_failed', 
          message: 'User not found or offline' 
        });
        return;
      }
      
      const targetConnData = connections.get(targetConnId);
      if (!targetConnData) {
        sendToConnection(conn, { 
          type: 'call_failed', 
          message: 'User not found or offline' 
        });
        return;
      }
      
      // Send call request to target user
      sendToConnection(targetConnData.conn, { 
        type: 'incoming_call', 
        from: connData.phoneNumber,
        sdpOffer: data.sdpOffer
      });
      break;

    case 'call_response':
      // User is responding to a call request
      const callerPhoneNumber = data.callerPhoneNumber;
      const accepted = data.accepted;
      
      const callerConnId = users.get(callerPhoneNumber);
      if (!callerConnId) {
        sendToConnection(conn, { 
          type: 'error', 
          message: 'Caller not found or offline' 
        });
        return;
      }
      
      const callerConnData = connections.get(callerConnId);
      if (!callerConnData) {
        sendToConnection(conn, { 
          type: 'error', 
          message: 'Caller not found or offline' 
        });
        return;
      }
      
      // Send response to caller
      sendToConnection(callerConnData.conn, { 
        type: 'call_answered', 
        by: connData.phoneNumber,
        accepted,
        sdpAnswer: accepted ? data.sdpAnswer : null
      });
      break;
      
    case 'ice_candidate':
      // ICE candidate for WebRTC connection
      const targetNumber = data.targetPhoneNumber;
      const targetId = users.get(targetNumber);
      
      if (targetId) {
        const targetData = connections.get(targetId);
        if (targetData) {
          sendToConnection(targetData.conn, { 
            type: 'ice_candidate', 
            from: connData.phoneNumber,
            candidate: data.candidate
          });
        }
      }
      break;

    case 'end_call':
      // User wants to end a call
      const endCallTargetNumber = data.targetPhoneNumber;
      const endCallTargetId = users.get(endCallTargetNumber);
      
      if (endCallTargetId) {
        const endCallTargetData = connections.get(endCallTargetId);
        if (endCallTargetData) {
          sendToConnection(endCallTargetData.conn, { 
            type: 'call_ended', 
            by: connData.phoneNumber
          });
        }
      }
      break;

    default:
      console.log('Unknown message type:', data.type);
      sendToConnection(conn, { 
        type: 'error', 
        message: 'Unknown message type' 
      });
  }
}

// Helper function to send a message to a connection
function sendToConnection(conn, data) {
  if (conn && conn.write) {
    conn.write(JSON.stringify(data));
  }
}

// Broadcast user status change to all connected users
function broadcastUserStatusChange(phoneNumber, isOnline) {
  connections.forEach((connData) => {
    if (connData.conn && connData.conn.write) {
      sendToConnection(connData.conn, {
        type: 'user_status_change',
        phoneNumber,
        isOnline
      });
    }
  });
}

// Attach SockJS server to HTTP server
sockjsServer.installHandlers(server);

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
