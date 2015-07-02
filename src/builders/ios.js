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

var defaultAppConfigTemplate = {
  name: "string.optional().keyed('CFBundleDisplayName').named('Application Name')",
  version: "string.regex(/(\\d+).(\\d+).(\\d+)/).optional().keyed('CFBundleVersion').named('Application Version')",
  versionName: "string.optional().keyed('CFBundleShortVersionString').named('Application Version Name')",
  bundleId: "string.optional().keyed('CFBundleIdentifier').named('Application Bundle Identifier')"
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
    var solutionRootPath = path.dirname(this.options.project.solutionPath.value);
    var configFilePath = path.join(solutionRootPath, this.options.project.configsPath.value, configName, 'ios.config.json');
    var configurationObject = JSON.parse(fs.readFileSync( configFilePath ));
  } catch(exception) {
    throw { innerException: exception, message: "Could not read the configuration file: " + configFilePath };
  }

  // Step2: See if there is any config_template.json present
  try {
    var projectRootPath = path.join(solutionRootPath, this.options.ios.projectName.value);
    var configTemplatePath = path.join(projectRootPath, 'config_template.json');
    var configTemplate = JSON.parse(fs.readFileSync(configTemplatePath, 'utf8'));
    configTemplate.app = appendObject(configTemplate.app, defaultAppConfigTemplate);
    var evaluationResult = configUtil.evaluate(configTemplate, configurationObject);
    if(!evaluationResult.isValid) throw { message: "iOS config '" + configName + "' is not valid according to the project's config template.", errors: evaluationResult.errors };
    configurationObject = evaluationResult.config;
  } catch(exception) {
    throw { innerException: exception, message: "Could not read the configuration template file: " + configTemplatePath };
  }

  // Step3: Manipulate Info.plist
  try {
    var plistPath = path.join(projectRootPath, 'Info.plist');
    for (var key in configurationObject.app) {
      var valueDetails = configurationObject.app[key];
      if(valueDetails.value) {
        setPlist(plistPath, valueDetails.key||key, valueDetails.value);
      }
    }
  } catch (exception) {
    throw { innerException: exception, message: "Could not update Info.plist" };
  }

  // Step4: Manipulate Config.plist

  // Step5: Copy resources if any

}

module.exports.prototype.build = function(callback) {

}

function appendObject(object1, object2) {
  if(!object1) return object2;
  for (var key in object2) {
    if (!object1.hasOwnProperty(key)) {
      object1[key] = object2[key];
    }
  }
  return object1;
}

function setPlist(plistPath, propertyName, value) {
  var execResult = exec('/usr/libexec/PlistBuddy -c "Set :' + propertyName + ' ' + value + '" "' + plistPath + '"');
  if(execResult.status != 0) throw { status: execResult.status, message: execResult.stderr, output: execResult.stdout };
}
