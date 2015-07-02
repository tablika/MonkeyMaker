var configUtil = require('../config.js');
var fs = require('fs-extra');
var path = require('path');
var exec = require('sync-exec');     // Exec utilities

var optionsTemplate = {
  ios: {
    mdtoolPath: "string.default('/Applications/Xamarin Studio.app/Contents/MacOS/mdtool')",
    projectName: "string",
    resourcesPath: "string.default('Resources')"
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

module.exports.prototype.installConfig = function(configName) {

  // Step1: read the config file.
  try {
    var solutionRootPath = path.dirname(this.options.project.solutionPath.value);
    var configFilePath = path.join(resolvePath(solutionRootPath, this.options.project.configsPath.value), configName, 'ios.config.json');
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
    saveConfigObject(configurationObject.app, plistPath);
  } catch (exception) {
    throw { innerException: exception, message: "Could not update Info.plist" };
  }

  // Step4: Manipulate Config.plist
  try {
    var plistPath = path.join(projectRootPath, 'Config.plist');
    // We don't need the 'app' property anymore, just remove it.
    delete configurationObject.app;
    saveConfigObject(configurationObject, plistPath);
  } catch (exception) {
    throw { innerException: exception, message: "Could not update Config.plist" };
  }

  // Step5: Copy resources if any
  try {
    var projectResourcesPath = resolvePath(projectRootPath, this.options.ios.resourcesPath.value);
    var configResourcesPath = path.join(resolvePath(solutionRootPath, this.options.project.configsPath.value), configName, 'ios.resources');
    if(fs.existsSync(projectResourcesPath) && fs.existsSync(configResourcesPath)) {
      fs.copySync(configResourcesPath, projectResourcesPath);
    }
  } catch (exception) {
    throw { innerException: exception, message: "Could not install resources for config: " + configName};
  }

}

module.exports.prototype.build = function(callback) {

}

function saveConfigObject(configObject, plistPath) {
  for (var key in configObject) {
    var valueDetails = configObject[key];
    if(valueDetails.value) {
      setPlist(plistPath, valueDetails.key||key, valueDetails.value);
    } else { // if there is no value given, it is an object with sub-properties (probably :D).
      saveConfigObject(configObject[key], plistPath);
    }
  }
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

function resolvePath(prefix, directoryPath) {
  if(path.isAbsolute(directoryPath)) return directoryPath;
  return path.join(prefix, directoryPath);
}
