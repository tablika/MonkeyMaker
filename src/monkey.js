var configUtil = require('config-util');  // Config validation.
var fs = require('fs-extra');                   // File I/O
var uuid = require('node-uuid');          // Unique id generator.
var format = require('string-format');    // String formatting
var path = require('path');               // Path utilities
var async = require('asyncawait/async');
var await = require('asyncawait/await');

format.extend(String.prototype);

/**
 * Create a Monkey instance.
 * @constructor
 * @param {object} options - The monkey project settings. Note that every action requires certain fields in the settings.
 */
module.exports = function (options) {

  this.options = options || { };
  this.eventHandlers = [];
  this.artifactProcessors = [];
  this.builders = {
    'ios': require('./builders/ios.js'),
    'android': require('./builders/android.js')
  };
  this.optionsTemplate = {
    project: {
      solutionPath: "string",
      configsPath: "string.default('oem')",
      outputPath: "string.default('output')"
    }
  };
  this.baseConfigTemplate = {
    projectName: "string",
    resourcesPath: "string.default('Resources')"
  };

}

module.exports.prototype.useEventHandler = function(eventHandler) {
  this.eventHandlers.push(eventHandler);
};

module.exports.prototype.useArtifactProcessor = function(artifactProcessor) {
  this.artifactProcessors.push(artifactProcessor);
}

module.exports.prototype.postEvent = function(event, args) {
  for (var i = 0; i < this.eventHandlers.length; i++) {
    try {
      if(this.eventHandlers[i][event])
        this.eventHandlers[i][event](args);
    } catch (exception) {
      console.error('Event handler throws error (has no effect on the deployment): ' + exception);
    }
  }
};

module.exports.prototype.build = function(target, platform, outputPath) {

  var builder = this.getBuilder(platform);
  return builder.build(target, outputPath);
};

module.exports.prototype.installConfig = function(configName, platform, overrides) {
  var configInfo = this.getConfigInfo(configName, platform);
  return this.installConfigWithInfo(configInfo, platform, overrides);
};

module.exports.prototype.installConfigWithInfo = function(configInfo, platform, overrides) {
  var builder = this.getBuilder(platform);
  return builder.installConfig(configInfo, overrides);
}

module.exports.prototype.getConfigInfo = function(configName, platform) {

  platform = typeof(platform) == 'string' ? platform.toLowerCase() : null;
  var template = this.optionsTemplate;
  if(!this.options.hasOwnProperty(platform)) {
    throw { message: "Monkey project is not configured for this platform: " + platform };
  }
  template[platform] = this.baseConfigTemplate;
  var evaluationResult = configUtil.evaluate(template, this.options);
  if(!evaluationResult.isValid) {
    throw { message: "Monkey project settings are not valid.", errors: evaluationResult.errors };
  }
  var options = evaluationResult.compile();

  var response = {};
  response.configName = configName;
  response.solutionFilePath = options.project.solutionPath;
  response.solutionPath = path.dirname(response.solutionFilePath);
  response.projectPath = path.join(response.solutionPath, options[platform].projectName);
  response.projectFilePath = path.join(response.projectPath, options[platform].projectName+'.csproj');
  response.configTemplateFilePath = path.join(response.projectPath, 'config_template.json');
  response.configPath = path.join(resolvePath(response.solutionPath, options.project.configsPath), configName, platform);
  return response;
};

module.exports.prototype.deploy = function (deployParams, callback) {

  var deployParams = configUtil.evaluate({
    configs: 'object',
    platforms: 'object',
    store_release: 'boolean.default(false)',
    version: 'string.optional()'
  }, deployParams);

  if(!deployParams.isValid) throw {errors: deployParams.errors, message: "deployParams is not valid."};
  deployParams = deployParams.compile();

  var projectSettings = configUtil.evaluate(this.optionsTemplate.project, this.options.project, 'project');
  if(!projectSettings.isValid) throw { errors: projectSettings.errors, message: "Monkey build project settings are not valid."};
  projectSettings = projectSettings.compile();

  var job = {
    id: uuid.v4(),
    configs: deployParams.configs,
    platforms: deployParams.platforms,
    isFinished: false,
    currentBuildConfig: null,
    lastUpdate: "Initializing",
    status: {
      successfulConfigs: [],
      failedConfigs: [],
      successful: 0,
      failed: 0,
      escaped: 0,
      escapedConfigs: [],
      remaining: deployParams.configs.length * deployParams.platforms.length,
      total: deployParams.configs.length * deployParams.platforms.length,
    },
    results: {}
  };

  var asyncTask = async(function() {
    this.postEvent('willStartJob', job);

    var configIndex = 1;
    for (var i = 0; i < deployParams.configs.length; i++) {
      var config = deployParams.configs[i];
      for (var j = 0; j < deployParams.platforms.length; j++) {
        var platform = deployParams.platforms[j];
        var configFriendlyName = '{0} ({1})'.format(config, platform.toLowerCase());
        var configDeployResults = { status: "Running", completedTasks: [] };
        if(!job.results.hasOwnProperty(config)) job.results[config] = {};
        job.results[config][platform] = configDeployResults;

        try {
          job.currentBuildConfig = config;
          job.lastUpdate = "Preparing for config '{0}'".format(config);
          var baseEventArgs = {
            configName: config,
            index: configIndex,
            platform: platform,
            jobId: job.id
          };

          // if the config exists, continue, otherwise add to escaped.
          var resolvedConfigsPath = resolvePath(path.dirname(projectSettings.solutionPath), projectSettings.configsPath);
          if(!fs.existsSync(path.join(resolvedConfigsPath, config, platform)) &&
              fs.existsSync(path.join(resolvedConfigsPath, config))) {
            this.postEvent('willEscapeConfig', baseEventArgs);
            job.status.escaped++;
            job.status.escapedConfigs.push(configFriendlyName);
            job.status.remaining--;
            configDeployResults.status = "Escaped"
            this.postEvent('didEscapeConfig', baseEventArgs);
            configIndex++;
            continue;
          }

          this.postEvent('willStartConfig', baseEventArgs);
          var currentTask = "Preparing";

          var configInfo = this.getConfigInfo(config, platform);

          // Step 1: Install the config.
          this.postEvent('willInstallConfig', baseEventArgs);
          currentTask = "Install Config";
          configDeployResults.status = "Installing Config";
          var configInstallationResults = await(this.installConfigWithInfo(configInfo, platform, {version: deployParams.version}));
          configDeployResults.completedTasks.push(currentTask);
          baseEventArgs.configSettings = configInstallationResults.configSettings;
          this.postEvent('didInstallConfig', baseEventArgs);

          // Step 2: Build the project.
          this.postEvent('willBuildConfig', baseEventArgs);
          currentTask = "Build Project";
          configDeployResults.status = "Building Project";
          var outputPath = resolvePath(path.dirname(projectSettings.solutionPath), projectSettings.outputPath);
          outputPath = path.join(outputPath, config, platform.toLowerCase());
          var buildResults = await(this.build(deployParams.store_release?'AppStore':'Release', platform, outputPath));
          if(!buildResults.success) throw buildResults;
          configDeployResults.completedTasks.push(currentTask);
          baseEventArgs.buildResults = buildResults;
          this.postEvent('didBuildConfig', baseEventArgs);
          delete baseEventArgs.buildResults;

          // Step 3: Process Artifacts
          for (var k = 0; k < this.artifactProcessors.length; k++) {
            var currentArtifactProcessor = this.artifactProcessors[k];
            if(currentArtifactProcessor.supports(platform.toLowerCase())) {
              baseEventArgs.artifactProcessorName = currentArtifactProcessor.name;
              this.postEvent('willProcessArtifact',  baseEventArgs);
              currentTask = "Process Artifact ({0})".format(currentArtifactProcessor.name);
              configDeployResults.status = "Processing Artifact ({0})".format(currentArtifactProcessor.name);
              var results = await(currentArtifactProcessor.process({monkey: this, config: configInstallationResults.configSettings.compile(), outputUrl: buildResults.outputUrl, configName: config, platform: platform}));
              if(!results.success) throw results;
              configDeployResults.completedTasks.push(currentTask);
              this.postEvent('didProcessArtifact', baseEventArgs);
            }
          }
          delete baseEventArgs.artifactProcessorName;
          baseEventArgs.results = configDeployResults;
          // Report the successful results.
          job.status.successful++;
          job.status.remaining--;
          job.status.successfulConfigs.push(configFriendlyName);
          configDeployResults.status = "Successful";
          configDeployResults.error = null;
          this.postEvent('didFinishConfig', baseEventArgs);

        } catch (exception) {
          // Update job
          job.status.failed++;
          job.status.remaining--;
          job.status.failedConfigs.push(configFriendlyName);
          // Update deploy results and post an event.
          configDeployResults.status= "Failed";
          configDeployResults.error= exception;
          configDeployResults.failedOn= currentTask;
          this.postEvent('didFailConfig', {error: exception, jobId: job.id, configName: config, index: configIndex, platform: platform, results: configDeployResults});
        }
        configIndex++;
      }
    }
    // Process the job.
    job.isFinished= true;
    job.currentBuildConfig= null;
    job.lastUpdate= "Job {0}!".format(job.status.failed>0?'Failed':'Succeeded');
    this.postEvent('didFinishJob', job);
    return job;
  }).bind(this);
  asyncTask().then(callback);
};

module.exports.prototype.getBuilder = function(platform) {
  var builderClass = this.builders[platform.toLowerCase()];
  if(!builderClass) throw { message: "Unsupported platform." };

  var template = this.optionsTemplate;
  if(!this.options.hasOwnProperty(platform)) {
    throw { message: "Monkey project is not configured for this platform: " + platform };
  }
  template[platform] = this.baseConfigTemplate;
  var evaluationResult = configUtil.evaluate(template, this.options);
  if(!evaluationResult.isValid) {
    throw { message: "Monkey project settings are not valid.", errors: evaluationResult.errors };
  }
  var options = evaluationResult.compile();
  return new builderClass(this, options);
}

function resolvePath(prefix, directoryPath) {
  if(path.isAbsolute(directoryPath)) return directoryPath;
  return path.join(prefix, directoryPath);
}
