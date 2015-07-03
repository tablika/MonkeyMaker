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

Monkey.prototype.build = function(target, platform, outputPath) {

  var builder = getBuilder(platform);
  return builder.build(target, outputPath);
}

Monkey.prototype.installConfig = function(configName, platform) {

  var builder = getBuilder(platform);
  return builder.installConfig(configName, callback);
}

function getBuilder(platform) {
  var builderClass = this.builders[platform.toLowerCase()];
  if(!builderClass) throw { message: "Unsupported platform." };

  return new builderClass(this);
}

try {
  var testOptions = {
    project: {
      solutionPath: "/Users/peyman/Projects/Tablika/src/CAIL.sln",
      configsPath: "/Users/peyman/Desktop/oem",
    },
    ios: {
      projectName: "Cail.iOS",
      resourcesPath: "res"
    }
  };
  var mk = new Monkey( testOptions );
  //mk.installConfig('Microsoft.staging', 'ios');
  mk.build('Debug', 'ios');
}
catch(ex){
  console.log(JSON.stringify(ex, null, 2));
}
