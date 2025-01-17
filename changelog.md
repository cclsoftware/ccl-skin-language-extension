# Changelog

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
