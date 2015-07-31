Welcome to the MonkeyMaker wiki!

## Introduction
We're going to start with the Monkey project settings.
Let's start by saying that the goal for MonkeyMaker is to support all mobile solutions meaning that it's aimed not only to support Xamarin but any solution that you can think of, including but not limited to native codes. However, the first step was to do it for Xamarin since Tablika actively uses it for Xamarin solutions. If you want to contribute, we would love to get in touch with you!

## Project Settings
Monkey works with a global project settings which is needed for each deployment job. Note that if you have two separate projects and don't want to deploy them at the same time, each project should have its own project settings and its own Monkey instance.

> Monkey reads the following parameters from the property "**project**" in your project settings file.

| Parameter | Description |
|--------------|------------------------------------------------------------------------------------------------------------------------------------------|
| solutionPath | (**Required**) The path to the solution file. |
| configPath | (Optional, default: **oem**) The path to the brands folder. Path is either absolute or relative to the same directory as the solution file. |
| outputPath | (Optional, default: **output**) The path of the output files. Path is either absolute or relative to the same director as the solution file. |

For example:
```JSON
{
	"project": {
		"solutionPath": "MyAwesomeApp.sln",
		"configPath": "../brands",
		"outputPath": "out"
	}
}
```


Now, monkey on its own is nothing special. It's the components that make it meaningful. There are three types of components.

## 1. Builders
Builders build! Their job is to install brands and build certain types of projects. For example, Xamarin.iOS will have its own builder, there is another builder to do the same thing for iOS projects written in Objective-C, same goes for Android, etc. You can create your own builder and plug it in the Monkey. There is limited support for Xamarin.iOS and Xamarin.Android that probably covers most of the cases but if you have special needs, you need to get in touch with authors of MonkeyMaker or just create your own builder.

For more information on creating your own builder, plugging in, etc, refer to **[Builders](../Builders)**.

## 2. Event Handlers
## 3. Artifact Processors
