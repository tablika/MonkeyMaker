var configUtil = require('../config.js');
var fs = require('fs-extra');
var path = require('path');
var exec = require('sync-exec');     // Exec utilities

var optionsTemplate = {
  ios: {
    mdtoolPath: "string.default('/Applications/Xamarin Studio.app/Contents/MacOS/mdtool')",
    projectName: "string",
    resourceDirectory: "string.default('Resources')"
  },
  project: {
    solutionPath: "string",
    configsPath: "string.default('oem')",
    outputPath: "string.default('output')"
  }
};

module.exports = function(monkey) {
  var options = monkey.options;
  var evaluationResult = configUtil.evaluate(optionsTemplate, options);
  if(!evaluationResult.isValid) throw { message: "iOS builder options are not valid.", errors: evaluationResult.errors };

  this.options = evaluationResult.config;
}

module.exports.prototype.installConfig = function(configName, callback) {

  // Step1: read the config file.
  try {
    var projectPath = path.dirname(this.options.project.solutionPath);
    var configFilePath = path.join(projectPath, this.options.project.configsPath, configName, 'ios.config.json');
    var configurationObject = JSON.parse(fs.readFileSync( configFilePath ));
  } catch(exception) {
    throw { innerException: exception, message: "Could not read the configuration file: " + configFilePath };
  }

  // Step2: See if there is any config_template.json present
  try {
    var configTemplatePath = path.join(projectPath, this.options.ios.projectName, 'config_template.json');
    var configTemplate = JSON.parse(fs.readFileSync(configTemplatePath, 'utf8'));
    var evaluationResult = configUtil.evaluate(configTemplate, configurationObject);
    if(!evaluationResult.isValid) throw { message: "iOS config '" + configName + "' is not valid according to the project's config template.", errors: evaluationResult.errors };
    configurationObject = evaluationResult.config;
  } catch(exception) {
    // Ignore it.
  }

  // Step3: Manipulate Info.plist
  try{
    var plistPath = path.join(projectPath, this.options.ios.projectName, 'Info.plist');
  } catch (exception) {

  }

  // Step4: Manipulate Config.plist

  // Step5: Copy resources if any

}

module.exports.prototype.build = function(callback) {

}

function setPlist(plistPath, propertyName, value) {
  exec('/usr/libexec/PlistBuddy -c "Set :' + propertyName + ' ' + value + '" "' + plistPath + '"');
}
