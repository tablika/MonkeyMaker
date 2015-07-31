Each builder class has to implement the following methods in order to be used in Monkey.

## installConfig
Installs a config in the project including its config files and resources.
Parameters (which will be sent to from Monkey):

**configInfo**: An object that provides info about the config that needs to be installed. It'll be something like below:

| property               | description                                                |
|------------------------|------------------------------------------------------------|
| configName             | The name of the config.                                    |
| solutionFilePath       | The absolute path to the solution file (*.sln)             |
| solutionPath           | The path to the folder in which the solution file resides. |
| projectFilePath        | The path to the project file (*.csproj for Xamarin).       |
| projectPath            | The path to the folder in which the project file resides.  |
| configTemplateFilePath | The path to the config template file<sup>1</sup>.                     |
| configPath             | The path to the root of this config for this platform.<sup>2</sup>   |

1. For more info about config template file, go to (here). It basically is a template which represents default values, validation logics and whether or not a field is required.
2. It will be root of the config for your builder so if your builder is named "kiwi" then the root would be something like:
configPath/configName/kiwi. You can read/write any file you want, this is your space. If you need extra files or resources or your own file structure, you can do it.

an example for **configInfo**:
```JavaScript
{
	"solutionFilePath": "/Users/admin/projects/myproject/myproject.sln",
	"solutionPath":"/Users/admin/projects/myproject",
	"configName":"Tablika",
	"projectFilePath":"/Users/admin/projects/myproject/myproject.ios/myproject.ios.csproj",
	"projectPath":"/Users/admin/projects/myproject/myproject.ios",
	"configTemplateFilePath":"/Users/admin/projects/myproject/myproject.ios/config_template.json",
	"configPath":"/Users/admin/projects/myproject/oem/Tablika/ios"
}
```

**overrides**
You shouldn't worry about this too much, this is for rare cases where you need to override some properties after reading the config file. So even if your config file has hypothetical value1 for key1, you need to override it with value2 for key1 given in the overrides object. This is not very common, it's probably useful when you want to inject properties like version from your CI.

```JavaScript
var installConfig = function(configInfo, overrides) {
   // You have config info and overrides. Go ahead and install it!
   return { installedConfigName: configInfo.configName, 
configSettings: evaluationResult }; 
// Note that evaluationResult is basically the evaluated, finalized and installed config settings.
}
```