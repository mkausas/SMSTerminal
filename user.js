var mongoose = require('mongoose');

var userSchema = new mongoose.Schema({
  createdAt: {
    type: Number,
    default: Date.now
  },
  updatedAt: {
    type: Number,
    default: Date.now
  },
  phoneNumber: String,
  hasAccess: {
    type: Boolean,
    default: true
  }
});

module.exports = mongoose.model('User', userSchema);
