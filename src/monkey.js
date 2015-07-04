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

Monkey.prototype.uploadToHockeyApp = function(appUrl, hockeyAppId, releaseNotesPath) {

  var hockeyAppConfig = configUtil.evaluate({apiKey: "string"}, this.options.hockeyApp);
  releaseNotesPath = releaseNotesPath ? '-notes_path="{0}"'.format(releaseNotesPath) : '';

  var execResult = exec('puck -api_token={0} -app_id={1} -submit=auto -download=true -open=notify -notify=false {2} {3}'
      .format(hockeyAppConfig.apiKey.value, hockeyAppId, releaseNotesPath, appUrl));

  return { success: execResult.status == 0, stdout: execResult.stdout, stderr: execResult.stderr };
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
