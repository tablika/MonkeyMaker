var configUtil = require('../config.js'); // Config utility created by MonkeyMaker
var fs = require('fs-extra');             // extentions to node.js's built-in fs library.
var path = require('path');               // Path utilities
var exec = require('sync-exec');          // Exec utilities
var format = require('string-format');    // String formatting
var uuid = require('node-uuid');          // Unique id generator.
var os = require('os');

format.extend(String.prototype);

var optionsTemplate = {
  ios: {
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
  version: "string.regex(/(\\d+)[.](\\d+)[.](\\d+)/).optional().keyed('CFBundleVersion').named('Application Version')",
  versionName: "string.optional().keyed('CFBundleShortVersionString').named('Application Version Name')",
  bundleId: "string.optional().keyed('CFBundleIdentifier').named('Application Bundle Identifier')"
};

module.exports = function(monkey) {
  var options = monkey.options;
  var evaluationResult = configUtil.evaluate(optionsTemplate, options);
  if(!evaluationResult.isValid) throw { message: "iOS builder options are not valid.", errors: evaluationResult.errors };

  this.options = evaluationResult.config;
  this.solutionRootPath = path.dirname(this.options.project.solutionPath.value);
  this.projectRootPath = path.join(this.solutionRootPath, this.options.ios.projectName.value);
}

module.exports.prototype.installConfig = function(configName) {

  var nameValuePair = {};

  // Step1: read the config file.
  try {
    var configFilePath = path.join(resolvePath(this.solutionRootPath, this.options.project.configsPath.value), configName, 'ios.config.json');
    var configurationObject = JSON.parse(fs.readFileSync( configFilePath ));
    var rawConfigObject = configurationObject;
    // Version Name adjustments
    if(!configurationObject.app.version && configurationObject.app.versionName) {
      var matchResults = /(\d+)[.](\d+)[.](\d+)/.exec(configurationObject.app.versionName);
      if(matchResults)
        configurationObject.app.version = '{0}.{1}.{2}'.format(matchResults[1], matchResults[2], matchResults[3]);
    }
  } catch(exception) {
    throw { innerException: exception, message: "Could not read the configuration file: " + configFilePath };
  }

  // Step2: See if there is any config_template.json present
  try {
    var configTemplatePath = path.join(this.projectRootPath, 'config_template.json');
    var configTemplate = JSON.parse(fs.readFileSync(configTemplatePath, 'utf8'));
    configTemplate.app = appendObject(configTemplate.app, defaultAppConfigTemplate);
    var evaluationResult = configUtil.evaluate(configTemplate, configurationObject);
  } catch(exception) {
    throw { innerException: exception, message: "Could not read the configuration template file: " + configTemplatePath };
  }
  if(!evaluationResult.isValid) throw { message: "iOS config '" + configName + "' is not valid according to the project's config template.", errors: evaluationResult.errors };
  configurationObject = evaluationResult.config;

  // Step3: Manipulate Info.plist
  try {
    var plistPath = path.join(this.projectRootPath, 'Info.plist');
    saveConfigObject(configurationObject.app, plistPath, nameValuePair);
  } catch (exception) {
    throw { innerException: exception, message: "Could not update Info.plist" };
  }

  // Step4: Manipulate Config.plist
  try {
    var plistPath = path.join(this.projectRootPath, 'Config.plist');
    saveConfigObject(configurationObject.config, plistPath, nameValuePair);
  } catch (exception) {
    throw { innerException: exception, message: "Could not update Config.plist" };
  }

  // Step5: Copy resources if any
  try {
    var projectResourcesPath = resolvePath(this.projectRootPath, this.options.ios.resourcesPath.value);
    var configResourcesPath = path.join(resolvePath(this.solutionRootPath, this.options.project.configsPath.value), configName, 'ios.resources');
    if(fs.existsSync(projectResourcesPath) && fs.existsSync(configResourcesPath)) {
      fs.copySync(configResourcesPath, projectResourcesPath);
    }
  } catch (exception) {
    throw { innerException: exception, message: "Could not install resources for config: " + configName};
  }

  return { installedConfigName: configName, configs: nameValuePair, rawConfig: rawConfigObject };
}

module.exports.prototype.build = function(target, outputPath) {

  var target = target || 'Release'; // default target is release.
  var buildResults = {};

  try {
    var buildId = uuid.v4();
    var tempDir = path.join(os.tmpdir(), 'com.monkeymaker.Builder', 'iOS.' + buildId);
    var packageName = 'app.ipa';
    var packageUrl = path.join(tempDir, packageName);

    // Clean it first.
    exec('xbuild {0} /p:Platform=iPhone /p:Configuration={1} /t:Clean'
        .format(path.join(this.projectRootPath, this.options.ios.projectName.value+".csproj"),
            target.replace(' ', '-')));

    // Build it.
    var execResult = exec('xbuild {0} /p:Platform=iPhone /p:Configuration={1} /p:BuildIpa=true /p:OutputPath="{2}/" /p:IpaPackageName="{3}"'
        .format(path.join(this.projectRootPath, this.options.ios.projectName.value+".csproj"),
            target.replace(' ', '-'), tempDir, packageName));

    buildResults.stdout = execResult.stdout;
    buildResults.success = execResult.status == 0;

    if(buildResults.success) {
      if(fs.existsSync(packageUrl)) {
        outputPath = outputPath || path.join(this.projectRootPath, 'bin', 'iPhone', target);
        fs.mkdirsSync(outputPath);
        var outputUrl = path.join(outputPath, packageName);
        fs.copySync(packageUrl, outputUrl);
        buildResults.outputUrl = outputUrl;
      } else {
        buildResults.success = false;
        buildResults.message = "xbuild returns success but no ipa was produced.";
      }
    } else {
      buildResults.message = "Build Failed";
    }

  } catch (exception) {
    buildResults.success = false;
    buildResults.exception = exception;
    buildResults.message = "Build failed.";
    if(execResult) buildResults.stderr = execResult.stderr;
  } finally {
    // Clean it.
    if(tempDir) {
      fs.removeSync(tempDir);
    }
  }
  return buildResults;
}

function saveConfigObject(configObject, plistPath, nameValuePair) {
  if(!configObject) return;
  for (var key in configObject) {
    var valueDetails = configObject[key];
    if(valueDetails && valueDetails.value) {
      setPlist(plistPath, valueDetails.key||key, valueDetails.value);
      if(valueDetails.name) nameValuePair[valueDetails.name] = valueDetails.value;
    } else { // if there is no value given, it is an object with sub-properties (probably :D).
      saveConfigObject(configObject[key], plistPath, nameValuePair);
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
  var execResult = exec('/usr/libexec/PlistBuddy -c "Set :{0} {1}" "{2}"'.format(propertyName, value, plistPath));
  if(execResult.status != 0) throw { status: execResult.status, message: execResult.stderr, output: execResult.stdout };
}

function resolvePath(prefix, directoryPath) {
  if(path.isAbsolute(directoryPath)) return directoryPath;
  return path.join(prefix, directoryPath);
}
