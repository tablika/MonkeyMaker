var configUtil = require('../config.js'); // Config utility created by MonkeyMaker
var fs = require('fs-extra');             // extentions to node.js's built-in fs library.
var path = require('path');               // Path utilities
var exec = require('sync-exec');          // Exec utilities
var format = require('string-format');    // String formatting
var uuid = require('node-uuid');          // Unique id generator.
var os = require('os');
var xml2js = require('xml2js');     // XML Parser

format.extend(String.prototype);

var optionsTemplate = {
  android: {
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
  name: "string.optional().named('Application Name')",
  version: "string.regex(/(\\d+)/).optional().keyed('CFBundleVersion').named('Application Version')",
  versionName: "string.optional().named('Application Version Name')",
  bundleId: "string.optional().named('Application Bundle Identifier')"
};

module.exports = function(monkey) {
  var options = monkey.options;
  var evaluationResult = configUtil.evaluate(optionsTemplate, options);
  if(!evaluationResult.isValid) throw { message: "Android builder options are not valid.", errors: evaluationResult.errors };

  this.options = evaluationResult.config;
  this.solutionRootPath = path.dirname(this.options.project.solutionPath.value);
  this.projectRootPath = path.join(this.solutionRootPath, this.options.android.projectName.value);
}

module.exports.prototype.installConfig = function (configName) {

  var nameValuePair = {};

  // Step1: read the config file.
  try {
    var configFilePath = path.join(resolvePath(this.solutionRootPath, this.options.project.configsPath.value), configName, 'android.config.json');
    var configurationObject = JSON.parse(fs.readFileSync( configFilePath ));
  } catch(exception) {
    throw { innerException: exception, message: "Could not read the configuration file: " + configFilePath };
  }

  // Step2: See if there is any config_template.json present
  try {
    var configTemplatePath = path.join(this.projectRootPath, 'config_template.json');
    var configTemplate = JSON.parse(fs.readFileSync(configTemplatePath, 'utf8'));
    configTemplate.app = appendObject(configTemplate.app, defaultAppConfigTemplate);
    // Version Name adjustments
    if(configurationObject.app.version && configurationObject.app.versionName) {
      var matchResults = /(\d+)[.](\d+)[.](\d+)/.exec(configTemplate.app.version.value);
      if(matchResults)
        configurationObject.app.version = configTemplate.app.version.replace('$version', matchResults[3]);
    }
    var evaluationResult = configUtil.evaluate(configTemplate, configurationObject);
    if(!evaluationResult.isValid) throw { message: "Android config '" + configName + "' is not valid according to the project's config template.", errors: evaluationResult.errors };
    configurationObject = evaluationResult.config;
  } catch(exception) {
    throw { innerException: exception, message: "Could not read the configuration template file: " + configTemplatePath };
  }

  var parser = new xml2js.Parser();
  var builder = new xml2js.Builder();
  // Step3: Manipulate Info.plist
  try {
    var manifestPath = path.join(this.projectRootPath, 'Properties', 'AndroidManifest.xml');
    var manifestXmlFile = fs.readFileSync(manifestPath, 'utf8');


  } catch (exception) {
    throw { innerException: exception, message: "Could not update Info.plist" };
  }

}
