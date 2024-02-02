# CCL Skin Language Support

CCL Skin Language Support is a Visual Studio Code extension to enable IntelliSense when editing files in the CCL Skin Definition Language.

This repository contains two sorts of builds:
1) .vsix builds that can be installed manually in Visual Studio Code
2) .js builds (from version 0.9.0 onwards) that can be used in continuous integration environments or to locally scan a codebase for errors. To run these builds, a [node.js](https://nodejs.org/) installation is required. If node.js is present, make sure the current working directory is inside the codebase you want to check and run
```
node <path/to/checkskinerrors.js>
```
To ignore certain directories inside the code base, append
```
-ignore "<relative/path/to/dir1> <relative/path/to/dir2>"
```
If any file's absolute path contains one of the ignore patterns, it is ignored by the script.

## Supported Features

**Hover documentation**

When hovering over elements in a skin XML document, the corresponding documentation taken from the `Skin Elements.classModel` is displayed in a popup window.

When hovering over variables, the possible values are displayed. For relative URLs, the absolute paths are displayed.

**Document validation**

Error squiggles are shown for any classes, attributes or attribute values that are not defined in the scope or have invalid values.

**Autocomplete**

For any styles, colors, enums, URLs, forms, variables, and attribute names, autocompletion information is provided based on the definitions in the classmodel and on all definitions in the currently edited skin pack.

**Color editor**

For concrete color definitions, the color is indicated using a little square preceding the color definition and a color editor opens on hover.

![Colorpicker](img/colorpicker.png)

**Go to definition**

For references to style, color, shape, image and form definitions or URLs, go to definition is available by right-clicking the definition or hitting *F12*. When going to a definition containing a skin variable, it can happen that multiple definitions are found since the variable can have different values. In this case, all possible definitions are shown.

![Colorpicker](img/gotodefinition.png)

**Find All References**

When right-clicking a symbol (i.e. the name of a form, style, color, shape, ...) "Find All References" is available. This command finds every source location in the repository that references the same definition as the right-clicked symbol.

**Rename Symbol**

When right-clicking a symbol (i.e. the name of a form, style, color, shape, ...) "Rename Symbol" is available. This command allows entering a new name for the selected symbol and renames all references to the symbol across the whole repository.
