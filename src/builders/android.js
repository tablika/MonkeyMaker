var configUtil = require('config-util'); // Config utility created by MonkeyMaker
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

var defaultAppConfigTemplate = {
  name: "string.optional().named('Application Name')",
  version: "string.regex(/(\\d+)/).optional().keyed('CFBundleVersion').named('Application Version')",
  versionName: "string.optional().named('Application Version Name')",
  bundleId: "string.optional().named('Application Bundle Identifier')"
};

module.exports = function(monkey, options) {
  this.options = options;
  this.monkey = monkey;
  this.solutionRootPath = path.dirname(this.options.project.solutionPath.value);
  this.projectRootPath = path.join(this.solutionRootPath, this.options.android.projectName.value);
}

module.exports.prototype.installConfig = async (function (configInfo, overrides) {

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
        configurationObject.app.version = matchResults[3];
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
  if(!evaluationResult.isValid) throw { message: "Android config '" + configInfo.configName + "' is not valid according to the project's config template.", errors: evaluationResult.errors };
  configurationObject = evaluationResult.config;

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
      }
      if(appConfig.bundleId && appConfig.bundleId.value) {
        manifestData['manifest']['$']['package'] = appConfig.bundleId.value;
      }
      if(appConfig.version && appConfig.version.value) {
        manifestData['manifest']['$']['android:versionCode'] = appConfig.version.value;
      }
      if(appConfig.versionName && appConfig.versionName.value) {
        manifestData['manifest']['$']['android:versionName'] = appConfig.versionName.value;
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
      this.options.android.resourcesPath, 'values', 'settings.xml');
    var settingsXmlFile = fs.readFileSync(settingsPath, 'utf8');

    var settingsData = await(parser.parseStringAsync(settingsXmlFile));
    saveConfigObject(configurationObject.config, settingsData);

    var newSettingsXmlFile = builder.buildObject(settingsData);
    fs.writeFileSync(settingsPath, newSettingsXmlFile);
  } catch (exception) {
    throw { innerException: exception, message: "Could not update settings.xml" };
  }

  // Step5: Copy resources if any
  try {
    var projectResourcesPath = path.join(configInfo.projectPath, this.options.android.resourcesPath);
    var configResourcesPath = path.join(configInfo.configPath, 'resources');
    if(fs.existsSync(projectResourcesPath) && fs.existsSync(configResourcesPath)) {
      fs.copySync(configResourcesPath, projectResourcesPath);
    }
  } catch (exception) {
    throw { innerException: exception, message: "Could not install resources for config: " + configInfo.configName};
  }

  return { installedConfigName: configInfo.configName, configSettings: evaluationResult };

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
        .format(path.join(this.projectRootPath, this.options.android.projectName+".csproj"),
            target.replace(' ', '-')));

    // Build it.
    var execResult = exec('xbuild {0} /p:Configuration={1} /t:SignAndroidPackage /p:OutputPath="{2}/"'
        .format(path.join(this.projectRootPath, this.options.android.projectName+".csproj"),
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

function saveConfigObject(configObject, settings) {
  if(!configObject) return;
  if(typeof(settings['resources']) != 'object')
    settings['resources'] = {};

  for (var key in configObject) {
    var valueDetails = configObject[key];
    if(valueDetails && valueDetails.hasOwnProperty('value')) {
      var type = typeof(valueDetails.value) == 'boolean' ? 'bool' : 'string';
      if(!settings['resources'][type]) settings['resources'][type] = [];
      setConfig(settings['resources'][type], valueDetails.key||key, valueDetails.value);
    } else { // if there is no value given, it is an object with sub-properties (probably :D).
      saveConfigObject(configObject[key], settings);
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
  data.push({'$':{'name': key}, '_': value});
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
