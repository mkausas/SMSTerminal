var mongoose = require('mongoose');

var requestSchema = new mongoose.Schema({
  createdAt: {
    type: Number,
    default: Date.now
  },
  updatedAt: {
    type: Number,
    default: Date.now
  },
  phoneNumber: String,
  running: {
    type: Boolean,
    default: false
  },
  timeout: {
    type: Number,
    default: 900000 //15 minutes
  }
});

module.exports = mongoose.model('Request', requestSchema);
