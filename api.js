// iris-redis API
//
// Copyright 2011 Iris Couch
//
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
//
//        http://www.apache.org/licenses/LICENSE-2.0
//
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

var redis = require('redis')
var commands = require('redis/lib/commands')
var util = require('util')

module.exports = {}
Object.keys(redis).forEach(function(key) {
  module.exports[key] = redis[key]
})

module.exports.createClient = function(port, host, options) {
  var client = redis.createClient(port, host, options)

  client._auth = client.auth
  client._same_tick = true
  process.nextTick(function() { client._same_tick = false })

  // Create an error object right now, so that the callback is more useful down the road.
  client._bad_command_er = new Error('Mandatory .auth() before any command')
  client._bad_info_er = new Error('You must run .auth() immediately after .createClient()')

  commands.forEach(function(command) {
    if(client.hasOwnProperty(command))
      throw new Error('Substututing non-prototype command not supported: ' + command)

    if(command == 'info')
      client[command] = bad_info
    else
      client[command] = bad_command(command)
  })

  client.auth = auth_wrapper
  client.iris_config = iris_config

  if(options && options.auth)
    client.auth(options.auth)

  return client
}

function bad_command(name) {
  return function() {
    if(this._same_tick)
      throw new Error(this._bad_command_er.message)
    else
      this.emit('error', this._bad_command_er)
  }
}

// Provide a more useful error message since info() is called implicitly for users.
function bad_info() {
  if(this._same_tick)
    throw new Error(this._bad_info_er.message)
  else
    this.emit('error', this._bad_info_er)
}


function auth_wrapper(pass, callback) {
  var self = this

  callback = callback || function() {}

  // With auth called, the faux commands can be removed, allowing normal commands to queue up.
  commands.forEach(function(command) {
    if(self.hasOwnProperty(command) && typeof self[command] == 'function')
      delete self[command]
  })

  pass = this.host + ":" + pass
  return self._auth(pass, function(er, res) {
    if(er)
      return callback(er)
    callback(er, res)
  })
}


function iris_config(callback) {
  var self = this

  if(typeof callback != 'function')
    throw new Error('iris_config requires a callback: function(error, config_obj)')

  self.smembers('_config', function(er, res) {
    if(er)
      return callback(er)

    var config = {}

    // This is synchronous becuase it's just a few keys, and it simplifies the code.
    get_config_key()
    function get_config_key() {
      var key = res.pop()
      if(!key)
        return callback(null, config)

      self.get(key, function(er, res) {
        if(er)
          return callback(er)
        config[key] = res
        return get_config_key()
      })
    }
  })
}
