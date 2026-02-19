# CCL Skin Language Support

CCL Skin Language Support is a Visual Studio Code extension to enable IntelliSense when editing files in the CCL Skin Definition Language.

A description of supported features can be found here: https://github.com/cclsoftware/ccl-skin-language-extension

## Getting Started

A `repo.json` file defines the project root and is used to autoconfigure this extension. This file can contain paths to directories and files that provide the knowledge needed for this extension to work.

The `repo.json` file may be empty. In this case the following default search paths apply:
 - Skin packs inside `<root>/skins`
 - The class model files `Skin Elements.classModel` and `Visual Styles.classModel` inside `<root>/classmodels`
 - Locale files (e.g. de.xml, fr.xml, es.xml...) inside `<root>/translations/locales`

The subfolder `locales` to find locale files is automatically appended to the `translations` path(s).

The structure of `repo.json` is as follows:

```json
{
	"skins": [
		"skins",
		"<other skins location relative to repo.json>"
	],
	"classmodels": [
		"classmodels",
		"<other class model location relative to repo.json>"
	],
	"translations": [
		"translations",
		"<other translations location relative to repo.json>"
	]
}
```

`repo.json` is a standard JSON file and does not support comments. If necessary, use a data field `"comment"` to contain a multi line comment as string array.

## Troubeshooting

**The first element in every Skin file shows an error to add the path to a classModel file in the settings.**

Explanation:\
The class model contains much of the language knowledge needed for IntelliSense and could not automatically be found. This extension contributes two settings to set the paths to the Skin Elements and Visual Styles class model files.

Solution:\
The files "Skin Elements.classModel" and "Visual Styles.classModel" are included in the CCL SDK and need to be present on your harddrive to use this extension. If you use a non empty `repo.json`, please make sure that the class model files can be found inside a folder specified in `"classmodels"` inside `repo.json`.

Alternatively you can add the absolute paths to the class model files to the settings:\
`"CCLSkin.classmodel.skinElements": "<path/to/Skin Elements.classModel>"`\
`"CCLSkin.classmodel.visualStyles": "<path/to/Visual Styles.classModel>"`

**A skin pack is not found when writing an `<import url="@..."/>` tag.**

Explanation:\
If nothing else is specified, all skin packs are expected to be inside `<root>/skins`. A skin pack has to have an own folder inside a skins location that contains at least a `skin.xml` file.

Solution:\
Please make sure that all skin packs have the correct structure (a folder containing at least `skin.xml`) and that they are inside `<root>/skins` or inside one of the locations specified in `"skins"` inside `repo.json`.

Alternatively you can add skins locations via the setting `"CCLSkin.skinsLocations": ["<location 1>", "<location 2>", ...]`.
