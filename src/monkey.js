var configUtil = require('./config.js');
var fs = require('fs');

var monkeyConfigTemplate = JSON.parse(fs.readFileSync('monkeyConfigTemplate.json', 'utf8'));

module.exports = Monkey;

function Monkey(options) {

  this.options = options || { };

  this.filters = [];

  this.builders = {
    'ios': require('./builders/ios.js'),
    'android': require('./builders/android.js')
  };

}

Monkey.prototype.use = function(filter) {
  this.filters.push(filter);
}

Monkey.prototype.postEvent = function(event, args) {
  for (var i = 0; i < this.filters.length; i++) {
    this.filters[i][event](args);
  }
}

Monkey.prototype.build = function() {
  this.postEvent("buildStarted");
}

Monkey.prototype.applyConfig(configName, platform, callback) {



}

var mk = new Monkey();
mk.build();
console.log(mk);
