# Changelog

**0.9.4 (2026-02-19)**

 - fix rename symbol renaming definition twice
 - also rename symbols in apps when renaming an external symbol inside a skin pack
 - fix styles defined in the current (non global) namespace not being suggested

-------------------------------------------------------------------

**0.9.3 (2025-11-26)**

 - fix go to external definition
 - fix definitions from other namespaces not being suggested
 - do not show errors for duplicate "definitions" of sized delegates
 - fix not showing error for styles in the global namespace referenced from a file inside a namespace without leading `/`
 - fix parsing skin expressions containing decimal numbers
 - fix autocomplete when typing an `Import` url
 - do not show errors for undefined variables requested by `defined` or `not.defined` in `switch` statements
 - fix error squiggle range for styles containing variables
 - include namespace when resolving `styleselector` values
 - do not show duplicate definition error for alternative definitions using `<?desktop_platform?>`

-------------------------------------------------------------------

**0.9.2 (2025-01-17)**

 - add support for the `override` attribute to explicitly override definitions
 - add support for rgb percent format (`rgb(0%,50%,100%)`)
 - add support for type `point3d`
 - fix loading class models on Windows
 - fix checking definitions for attributes of type `style[]`

-------------------------------------------------------------------

**0.9.1 (2024-07-31)**

 - find unqualified names in own skin file when being in a namespace
 - fix incorrect definition of size with two values `(left, top)` instead of `(width, height)`
 - allow setting only `<left>` or `<left>,<top>,<width>` of `size`
 - change type of `style` and `inherit` attributes to `style[]` instead of a single `style`
 - fix position of unclosed tag errors after multiple processing instructions
 - do not show errors for attributes (e.g. `size` or `int`) containing `@eval` expressions using unresolved external variables
 - do not show undefined variable errors for variables that are only required under certain conditions (e.g. inside `if` or `switch` blocks)

-------------------------------------------------------------------

**0.9.0 (2024-02-02)**

 - Initial public release
