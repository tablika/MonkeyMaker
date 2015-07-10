var configUtil = require('../config.js'); // Config utility created by MonkeyMaker
var fs = require('fs-extra');             // extentions to node.js's built-in fs library.
var path = require('path');               // Path utilities
var exec = require('sync-exec');          // Exec utilities
var format = require('string-format');    // String formatting
var uuid = require('node-uuid');          // Unique id generator.
var os = require('os');
var async = require('asyncawait/async');
var await = require('asyncawait/await');
var Promise = require("bluebird");
var xml2js = Promise.promisifyAll(require("xml2js"));

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

module.exports.prototype.installConfig = async (function (configName) {

  var nameValuePair = {};

  // Step1: read the config file.
  try {
    var configFilePath = path.join(resolvePath(this.solutionRootPath, this.options.project.configsPath.value), configName, 'android.config.json');
    var configurationObject = JSON.parse(fs.readFileSync( configFilePath ));
    // Version Name adjustments
    if(!configurationObject.app.version && configurationObject.app.versionName) {
      var matchResults = /(\d+)[.](\d+)[.](\d+)/.exec(configurationObject.app.versionName);
      if(matchResults)
        configurationObject.app.version = matchResults[3];
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
    if(!evaluationResult.isValid) throw { message: "Android config '" + configName + "' is not valid according to the project's config template.", errors: evaluationResult.errors };
    configurationObject = evaluationResult.config;
  } catch(exception) {
    throw { innerException: exception, message: "Could not read the configuration template file: " + configTemplatePath };
  }

  var parser = new xml2js.Parser();
  var builder = new xml2js.Builder();

  // Step3: Manipulate AndroidManifest.xml
  try {
    var appConfig = configurationObject.app;
    if(configurationObject.app) {

      var manifestPath = path.join(this.projectRootPath, 'Properties', 'AndroidManifest.xml');
      var manifestXmlFile = fs.readFileSync(manifestPath, 'utf8');

      var manifestData = await(parser.parseStringAsync(manifestXmlFile));
      if(appConfig.name && appConfig.name.value) {
        manifestData['manifest']['application'][0]['$']['android:label'] = appConfig.name.value;
        nameValuePair[appConfig.name.name||'name'];
      }
      if(appConfig.bundleId && appConfig.bundleId.value) {
        manifestData['manifest']['$']['package'] = appConfig.bundleId.value;
        nameValuePair[appConfig.bundleId.name||'bundleId'];
      }
      if(appConfig.version && appConfig.version.value) {
        manifestData['manifest']['$']['android:versionCode'] = appConfig.version.value;
        nameValuePair[appConfig.version.name||'version'];
      }
      if(appConfig.versionName && appConfig.versionName.value) {
        manifestData['manifest']['$']['android:versionName'] = appConfig.versionName.value;
        nameValuePair[appConfig.versionName.name||'versionName'];
      }
      var newManifestXmlFile = builder.buildObject(manifestData);
      fs.writeFileSync(manifestPath, newManifestXmlFile);
    }
  } catch (exception) {
    throw { innerException: exception, message: "Could not update AndroidManifest.xml" };
  }

  // Step4: Manipulate settings.xml
  try {
    var settingsPath = path.join(this.projectRootPath,
      this.options.android.resourcesPath.value, 'values', 'settings.xml');
    var settingsXmlFile = fs.readFileSync(settingsPath, 'utf8');

    var settingsData = await(parser.parseStringAsync(settingsXmlFile));
    saveConfigObject(configurationObject.config, settingsData, nameValuePair);
  } catch (exception) {
    throw { innerException: exception, message: "Could not update settings.xml" };
  }

  // Step5: Copy resources if any
  try {
    var projectResourcesPath = resolvePath(this.projectRootPath, this.options.android.resourcesPath.value);
    var configResourcesPath = path.join(resolvePath(this.solutionRootPath, this.options.project.configsPath.value), configName, 'android.resources');
    if(fs.existsSync(projectResourcesPath) && fs.existsSync(configResourcesPath)) {
      fs.copySync(configResourcesPath, projectResourcesPath);
    }
  } catch (exception) {
    throw { innerException: exception, message: "Could not install resources for config: " + configName};
  }

  return { installedConfigName: configName, configs: nameValuePair };

});

module.exports.prototype.build = function(target, outputPath) {

  var target = target || 'Release'; // default target is release.
  var buildResults = {};

  if(target == 'AppStore') target == 'Release'; // Release is used even for Store

  try {

    var parser = new xml2js.Parser();

    var buildId = uuid.v4();
    var tempDir = path.join(os.tmpdir(), 'com.monkeymaker.Builder', 'Android.' + buildId);

    // Clean it first.
    exec('xbuild {0} /p:Configuration={1} /t:Clean'
        .format(path.join(this.projectRootPath, this.options.android.projectName.value+".csproj"),
            target.replace(' ', '-')));

    // Build it.
    var execResult = exec('xbuild {0} /p:Configuration={1} /t:SignAndroidPackage /p:OutputPath="{2}/"'
        .format(path.join(this.projectRootPath, this.options.android.projectName.value+".csproj"),
            target.replace(' ', '-'), tempDir));

    buildResults.stdout = execResult.stdout;
    buildResults.success = execResult.status == 0;

    var filesList = fs.readdirSync(tempDir).filter(function(file) {
      return (/-Signed[.]apk$/.exec(file) != null);
    });

    if(buildResults.success) {
      if(filesList.length > 0) {
        var packageUrl = path.join(tempDir, filesList[0]);
        outputPath = outputPath || path.join(this.projectRootPath, 'bin', target);
        fs.mkdirsSync(outputPath);
        var outputUrl = path.join(outputPath, "app.apk");
        fs.copySync(packageUrl, outputUrl);
        buildResults.outputUrl = outputUrl;
      } else {
        buildResults.success = false;
        buildResults.message = "xbuild returns success but no apk was produced.";
      }
    } else {
      buildResults.message = 'Build Failed';
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

function saveConfigObject(configObject, settings, nameValuePair) {
  if(!configObject) return;
  for (var key in configObject) {
    var valueDetails = configObject[key];
    if(valueDetails && valueDetails.value) {
      var type = typeof(valueDetails.value) == 'boolean' ? 'bool' : 'string';
      setConfig(settings['resources'][type], valueDetails.key||key, valueDetails.value);
      if(valueDetails.name) nameValuePair[valueDetails.name] = valueDetails.value;
    } else { // if there is no value given, it is an object with sub-properties (probably :D).
      saveConfigObject(configObject[key], plistPath);
    }
  }
}

function setConfig(data, key, value) {
  for(var i = 0; i < data.length; i++) {
    if(data[i]['$']['name'] === key) {
      data[i]['_'] = value;
      return;
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

function resolvePath(prefix, directoryPath) {
  if(path.isAbsolute(directoryPath)) return directoryPath;
  return path.join(prefix, directoryPath);
}
