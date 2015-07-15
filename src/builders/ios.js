var configUtil = require('config-util');  // Config utilities.
var fs = require('fs-extra');             // extentions to node.js's built-in fs library.
var path = require('path');               // Path utilities
var exec = require('sync-exec');          // Exec utilities
var format = require('string-format');    // String formatting
var uuid = require('node-uuid');          // Unique id generator.
var os = require('os');

format.extend(String.prototype);

var defaultAppConfigTemplate = {
  name: "string.optional().keyed('CFBundleDisplayName').named('Application Name')",
  version: "string.regex(/(\\d+)[.](\\d+)[.](\\d+)/).optional().keyed('CFBundleVersion').named('Application Version')",
  versionName: "string.optional().keyed('CFBundleShortVersionString').named('Application Version Name')",
  bundleId: "string.optional().keyed('CFBundleIdentifier').named('Application Bundle Identifier')"
};

module.exports = function(monkey, options) {
  this.options = options;
  this.monkey = monkey;
  this.solutionRootPath = path.dirname(this.options.project.solutionPath);
  this.projectRootPath = path.join(this.solutionRootPath, this.options.ios.projectName);
}

module.exports.prototype.installConfig = function(configInfo, overrides) {

  // Step1: read the config file.
  try {
    var configurationObject = JSON.parse(fs.readFileSync(path.join(configInfo.configPath, 'config.json'), 'utf8'));
    // Version Name adjustments
    if(overrides.version) {
      configurationObject.app.versionName = overrides.version;
    }
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
    var configTemplate = JSON.parse(fs.readFileSync(configInfo.configTemplateFilePath, 'utf8'));
    configTemplate.app = appendObject(configTemplate.app, defaultAppConfigTemplate);
    var evaluationResult = configUtil.evaluate(configTemplate, configurationObject);
  } catch(exception) {
    throw { innerException: exception, message: "Could not read the configuration template file: " + configTemplatePath };
  }
  if(!evaluationResult.isValid) throw { message: "iOS config '" + configInfo.name + "' is not valid according to the project's config template.", errors: evaluationResult.errors };
  configurationObject = evaluationResult.configs;

  // Step3: Manipulate Info.plist
  try {
    var plistPath = path.join(configInfo.projectPath, 'Info.plist');
    saveConfigObject(configurationObject.app, plistPath);
  } catch (exception) {
    throw { innerException: exception, message: "Could not update Info.plist" };
  }

  // Step4: Manipulate Config.plist
  try {
    var plistPath = path.join(configInfo.projectPath, 'Config.plist');
    saveConfigObject(configurationObject.config, plistPath);
  } catch (exception) {
    throw { innerException: exception, message: "Could not update Config.plist" };
  }

  // Step5: Copy resources if any
  try {
    var projectResourcesPath = path.join(configInfo.projectPath, this.options.ios.resourcesPath);
    var configResourcesPath = path.join(configInfo.configPath, 'resources');
    if(fs.existsSync(projectResourcesPath) && fs.existsSync(configResourcesPath)) {
      fs.copySync(configResourcesPath, projectResourcesPath);
    }
  } catch (exception) {
    throw { innerException: exception, message: "Could not install resources for config: " + configInfo.name};
  }

  return { installedConfigName: configInfo.configName, configSettings: evaluationResult };
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

function saveConfigObject(configObject, plistPath) {
  if(!configObject) return;
  for (var key in configObject) {
    var valueDetails = configObject[key];
    if(valueDetails && valueDetails.value) {
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
  var execResult = exec('/usr/libexec/PlistBuddy -c "Set :{0} {1}" "{2}"'.format(propertyName, value, plistPath));
  if(execResult.status != 0) throw { status: execResult.status, message: execResult.stderr, output: execResult.stdout };
}
