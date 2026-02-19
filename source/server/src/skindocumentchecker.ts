//************************************************************************************************
//
// CCL Skin Language Extension
//
// This file is part of Crystal Class Library (R)
// Copyright (c) 2025 CCL Software Licensing GmbH.
// All Rights Reserved.
//
// Licensed for use under either:
//  1. a Commercial License provided by CCL Software Licensing GmbH, or
//  2. GNU Affero General Public License v3.0 (AGPLv3).
// 
// You must choose and comply with one of the above licensing options.
// For more information, please visit ccl.dev.
//
// Filename    : server/src/skindocumentchecker.ts
// Description : Skin Document Checker
//
//************************************************************************************************

import {
	Diagnostic,
	DiagnosticSeverity,
	ColorInformation,
	Location,
	Range,
	DiagnosticRelatedInformation
} from 'vscode-languageserver';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { ElementType } from 'htmlparser2';
import { Element, ProcessingInstruction } from 'domhandler';
import { ClassModelManager, AttributeType } from './classmodelmanager';
import { DefinitionType, LookupDefinitionOptions, SkinDefinitionParser } from './skindefinitionparser';
import * as fs from 'fs';
import { DomHelper } from './domhelper';
import { DocumentManager, TagAttribute, TagAttributes } from './documentmanager';
import { IntelliSenseProvider } from './intellisenseprovider';

//************************************************************************************************
// Definitions
//************************************************************************************************

type TagAttributeInfo = {
	tag: Element,
	textDocument: TextDocument,
	attributes: TagAttributes,
	attributeName: string,
	correctedAttributeName: string,
	attributeValue: string,
	originalAttributeValue: string
};

const intRegex = "((?:-?\\d+)|(?:.*@property:.+))";
const floatRegex = "((?:-?\\d+(?:\\.\\d+)?)|(?:.*@property:.+))";
const kDiagnosticSource = "CCL Skin Validation";

export const kValidationDelay = 500; //< in milliseconds

//************************************************************************************************
// SkinDocumentChecker
//************************************************************************************************

export class SkinDocumentChecker
{
	private static hasDiagnosticRelatedInformationCapability = false;
	private static currentCheckTime = 0;

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static abortCurrentCheck ()
	{
		this.currentCheckTime = new Date ().valueOf ();
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static setHasDiagnosticRelatedInformationCapability (value: boolean)
	{
		this.hasDiagnosticRelatedInformationCapability = value;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static checkDocument (textDocument: TextDocument)
	{
		return new Promise<Diagnostic[]> ((resolve, reject) =>
		{
			let skinRoot = this.getSkinRoot (textDocument.uri);
			if(skinRoot == null)
			{
				resolve ([]);
				return; // not a ccl skin xml -> don't run validation
			}

			let diagnostics: Diagnostic[] = [];

			let addGlobalDiagnostic = (message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error, related?: DiagnosticRelatedInformation) =>
			{
				if(skinRoot == null)
					return; // shouldn't happen

				let startIndex = skinRoot.startIndex;
				if(startIndex == null)
					startIndex = 0;

				for(let i = 0; i < diagnostics.length; i++)
				{
					if(diagnostics[i].message == message)
					{
						let otherRelated = diagnostics[i].relatedInformation;
						if(related == null && otherRelated == null)
							continue;
						else if(related && otherRelated && otherRelated[0].message == related.message
							&& otherRelated[0].location.uri == related.location.uri
							&& SkinDefinitionParser.equalRange (otherRelated[0].location.range, related.location.range))
						{
							continue;
						}

						return;
					}
				}

				diagnostics.push ({
					severity: severity,
					range: {
						start: textDocument.positionAt (startIndex),
						end: textDocument.positionAt (startIndex + skinRoot.name.length + 2) // + 2 for <>
					},
					message: message,
					relatedInformation: related && this.hasDiagnosticRelatedInformationCapability ? [related] : undefined,
					source: kDiagnosticSource
				});
			};

			if(!ClassModelManager.isClassModelLoaded ())
			{
				addGlobalDiagnostic (`The class model file could not be found. Skipping validation. ` +
									`Please add the path for the "Skin Elements.classModel" file to your settings.`, DiagnosticSeverity.Error);

				resolve (diagnostics);
				return;
			}

			if(!SkinDefinitionParser.isPartOfOwnSkinPack (textDocument.uri))
			{
				addGlobalDiagnostic (`This file is nowhere included in it's skin pack. Skipping validation.`, DiagnosticSeverity.Warning);
				resolve (diagnostics);
				return;
			}
			else if(SkinDefinitionParser.isSkinRoot (textDocument.uri))
			{
				let definitions = SkinDefinitionParser.getExternalDefinitions ();
				for(let i = 0; i < definitions.length; i++)
				{
					if(!SkinDefinitionParser.isDefined (textDocument.uri, definitions[i].type, definitions[i].def))
					{
						let d = definitions[i];
						addGlobalDiagnostic (`No definition found for ${this.definitionTypeToString (d.type)} "${d.def}".`,
											DiagnosticSeverity.Error, { message: "Requested here", location: d.context });
					}
				}
			}

			IntelliSenseProvider.setColorsInDocument (textDocument.uri, []);

			let root = skinRoot;
			SkinDocumentChecker.checkNode (diagnostics, root, textDocument, this.currentCheckTime, this.currentCheckTime).then (() =>
			{
				let unclosedTags = DocumentManager.findUnclosedTags (textDocument.uri);
				for(let i = 0; i < unclosedTags.unclosedTags.length; i++)
				{
					let unclosedTag = unclosedTags.unclosedTags[i];
					let postfix = unclosedTag.originalName.startsWith ("?") ? "?" : "";
					diagnostics.push ({
						severity: unclosedTag.originalName == "?xstring" ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
						range: {
							start: textDocument.positionAt (unclosedTag.index),
							end: textDocument.positionAt (unclosedTag.index + unclosedTag.originalName.length)
						},
						message: `No closing tag found for <${unclosedTag.originalName + postfix}>.`,
						source: kDiagnosticSource
					});
				}

				for(let i = 0; i < unclosedTags.danglingClosingTags.length; i++)
				{
					let danglingTag = unclosedTags.danglingClosingTags[i];
					diagnostics.push ({
						severity: DiagnosticSeverity.Error,
						range: {
							start: textDocument.positionAt (danglingTag.index),
							end: textDocument.positionAt (danglingTag.index + danglingTag.name.length)
						},
						message: `Dangling tag <${danglingTag.name}> found.`,
						source: kDiagnosticSource
					});
				}

				let duplicateDefinitions = SkinDefinitionParser.getDuplicateDefinitions (textDocument.uri);
				for(let i = 0; i < duplicateDefinitions.length; i++)
				{
					let def = duplicateDefinitions[i];

					diagnostics.push ({
						severity: DiagnosticSeverity.Error,
						range: def.range,
						relatedInformation: this.hasDiagnosticRelatedInformationCapability ? [{ location: def.otherDefinition, message: "Duplicate definition" }] : undefined,
						message: `Redefinition of ${this.definitionTypeToString (def.type)} "${def.name}".`,
						source: kDiagnosticSource
					});
				}

				resolve (diagnostics);
			})
			.catch (() =>
			{
				reject ();
			});;
		});
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getSkinRoot (uri: string)
	{
		let document = DocumentManager.getCurrentDocument (uri, true);
		if(document == null)
			return null;

		return DomHelper.findFirstChild (document.content, "Skin");
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static definitionTypeToString (type: DefinitionType)
	{
		let typeName = "";
		if(type == DefinitionType.kColor)
			typeName = "color";
		else if(type == DefinitionType.kFont)
			typeName = "font";
		else if(type == DefinitionType.kForm)
			typeName = "form";
		else if(type == DefinitionType.kImage)
			typeName = "image";
		else if(type == DefinitionType.kShape)
			typeName = "shape";
		else if(type == DefinitionType.kStyle || type == DefinitionType.kAppStyle)
			typeName = "style";
		else if(type == DefinitionType.kSizedDelegate)
			typeName = "sized delegate";
		else if(type == DefinitionType.kVariable)
			typeName = "variable";

		return typeName;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkNode (diagnostics: Diagnostic[], node: Element, textDocument: TextDocument, timestamp: number, originalTime: number)
	{
		if(originalTime < this.currentCheckTime)
			return new Promise<void> ((_, reject) => { reject (); });

		let currentTime = new Date ().valueOf ();
		if(currentTime - timestamp > kValidationDelay)
		{
			return new Promise<void> ((resolve, reject) =>
			{
				setTimeout (() => { this.checkNode (diagnostics, node, textDocument, currentTime, originalTime)
					.then ((diagnostics) => { resolve (); })
					.catch (() => { reject (); }); }, 0);
			});
		}

		let children = node.children;
		return new Promise<void> ((resolve, reject) =>
		{
			let promises: Promise<void>[] = [];
			for(let i = 0; i < children.length; i++)
			{
				if(children[i].type != ElementType.Tag && children[i].type != ElementType.Directive)
					continue;

				let child = children[i] as Element | ProcessingInstruction;
				if(child.startIndex == null)
					continue;

				let childStartIndex = child.startIndex + 1;
				let addDiagnostic = (message: string, severity: DiagnosticSeverity, additionalInformation?: string, additionalLocation?: Location) =>
				{
					let diagnostic: Diagnostic = {
						severity: severity,
						range: {
							start: textDocument.positionAt (childStartIndex),
							end: textDocument.positionAt (childStartIndex + (children[i] as Element | ProcessingInstruction).name.length)
						},
						message: message,
						source: kDiagnosticSource
					};

					if(additionalInformation != null && this.hasDiagnosticRelatedInformationCapability)
					{
						if(additionalLocation == null)
							additionalLocation = { uri: textDocument.uri, range: Object.assign ({}, diagnostic.range) };

						diagnostic.relatedInformation = [{ location: additionalLocation, message: additionalInformation }];
					}

					diagnostics.push (diagnostic);
				};

				if(child instanceof ProcessingInstruction)
				{
					let tagText = DocumentManager.findTagText (child, textDocument.uri);
					if(tagText.length > 0 && !tagText.endsWith ("?"))
						addDiagnostic ("Malformed processing instruction. Please add a \"?\" at the end.", DiagnosticSeverity.Error);

					continue;
				}

				let parentName = "";
				if(child.parent != null)
					parentName = (child.parent as Element).name;

				let classNames = ClassModelManager.findSkinElementDefinitions (child.name);
				if(classNames.indexOf (child.name) == -1) // invalid class name
				{
					let msg = `Unknown element "${child.name}".`;
					let isWrongCase = false;
					for(let c = 0; c < classNames.length; c++)
					{
						if(classNames[c].toLowerCase () == child.name.toLowerCase ())
						{
							isWrongCase = true;
							msg = `Incorrect casing with element "${child.name}".`;
							break;
						}
					}

					let additionalInformation: string | undefined = undefined;
					if(this.hasDiagnosticRelatedInformationCapability)
					{
						let validClassNames = [];
						for(let classNameIndex = 0; classNameIndex < classNames.length; classNameIndex++)
						{
							if(ClassModelManager.isSkinElementValidInScope (parentName, classNames[classNameIndex]))
								validClassNames.push (classNames[classNameIndex]);
						}

						if(validClassNames.length > 0)
						{
							let message = "";
							if(validClassNames.length == 1)
								message += validClassNames[0];
							else
							{
								for(let n = 0; n < validClassNames.length; n++)
								{
									message += validClassNames[n];
									if(n < validClassNames.length - 2)
										message += ", ";
									else if(n < validClassNames.length - 1)
										message += " or ";
								}
							}

							additionalInformation = 'Did you mean ' + message + '?';
						}
					}

					addDiagnostic (msg, isWrongCase ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error, additionalInformation);
				}
				else
				{
					const kCommandName = "command.name";
					const kCommandCategory = "command.category";
					if(parentName.toLowerCase () == "if" && child.name.toLowerCase () == "default")
					{
						let additionalInformation: string | undefined = undefined;
						if(this.hasDiagnosticRelatedInformationCapability)
						{
							let ifElem = (<Element>child.parent);
							let property = ifElem.attribs["property"];
							let value = ifElem.attribs["value"];
							if(value == null)
								value = "true";

							if(property != null)
							{
								let indent = "";
								for(let indentDepth = 0; indentDepth < 4; indentDepth++)
									indent += "\u00A0";

								let suggestion = "\nUse this instead:\n";
								suggestion += "| <switch property=\"" + property + "\">\n";
								suggestion += "| " + indent + "<case value=\"" + value + "\">...</case>\n";
								suggestion += "| " + indent + "<default>...</default>\n";
								suggestion += "| </switch>";

								additionalInformation = suggestion;
							}
						}

						addDiagnostic (`"default" should only be used within "switch".`, DiagnosticSeverity.Warning, additionalInformation);
					}
					else if(child.name.toLowerCase () == "externals" && !SkinDefinitionParser.isSkinRoot (textDocument.uri))
						addDiagnostic (`Element "${child.name}" is only allowed in skin.xml of skin packs, plugins, services or extensions.`, DiagnosticSeverity.Error);
					else if(!ClassModelManager.isSkinElementValidInScope (parentName, child.name))
						addDiagnostic (`Element "${child.name}" is not a valid child for "${parentName}".`, DiagnosticSeverity.Error);
					else if(child.name == "Form" && child.attribs["attach"] == null && child.attribs["name"] != null)
					{
						let locations = SkinDefinitionParser.lookupDefinition (textDocument.uri, DefinitionType.kSizedDelegate, child, child.attribs["name"]);
						for(let l = 0; l < locations.length; l++)
						{
							let additionalInformation: string | undefined = undefined;
							let additionalLocation: Location | undefined = undefined;
							if(this.hasDiagnosticRelatedInformationCapability)
							{
								additionalInformation = "The referencing Delegate";
								additionalLocation = locations[l];
							}

							addDiagnostic (`This Form is referenced in a sized Delegate, but has no attach attribute.`,
											DiagnosticSeverity.Warning, additionalInformation, additionalLocation);
						}
					}
					else if(child.attribs[kCommandName] != null && child.attribs[kCommandCategory] == null)
						addDiagnostic (`"${kCommandCategory}" is missing.`, DiagnosticSeverity.Warning);
					else if(child.attribs[kCommandName] == null && child.attribs[kCommandCategory] != null)
						addDiagnostic (`"${kCommandName}" is missing.`, DiagnosticSeverity.Warning);

					this.checkAttributes (diagnostics, textDocument, child);
				}

				promises.push (this.checkNode (diagnostics, child, textDocument, timestamp, originalTime));
			}

			Promise.all (promises)
				.then (() => { resolve (); })
				.catch (() => { reject () });
		});
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkAttributes (diagnostics: Diagnostic[], textDocument: TextDocument, child: Element)
	{
		if(child.name != "define") // arbitrary attributes are allowed in defines
		{
			let tagName = IntelliSenseProvider.resolveElementName (child).name;
			let attributes = ClassModelManager.findValidAttributes (tagName);
			let childAttributes = null;
			for(let attributeName in child.attribs)
			{
				const reDefError = `Redefinition of "${attributeName}".`;
				const invalidError = `"${attributeName}" is an invalid attribute for "${tagName}".`;
				const wrongCaseWarning = `Incorrect casing with attribute name "${attributeName}".`;

				let found = false;
				let foundWithoutUnderscore = false;
				let foundCaseInsensitive = false;
				let attributeNameWithoutUnderscore = attributeName.replace (/_/g, "");
				if(attributeName.startsWith ("data.") || attributeNameWithoutUnderscore.startsWith ("data."))
					continue; // data.xxxx is a special attribute that is evaluated by the controller

				let correctedAttributeName = attributeName;

				for(let a in attributes)
				{
					if(a == attributeName)
					{
						found = true;
						break;
					}
					else if(a == attributeNameWithoutUnderscore)
					{
						foundWithoutUnderscore = true;
						correctedAttributeName = a;
					}
					else if(a.toLowerCase () == attributeName.toLowerCase ())
					{
						foundCaseInsensitive = true;
						correctedAttributeName = a;
					}
				}

				if(!found)
					found = foundWithoutUnderscore;

				if(childAttributes == null)
					childAttributes = DocumentManager.findTagAttributes (child, DocumentManager.findTagText (child, textDocument.uri));

				let childAttribute = childAttributes[attributeName];
				if(childAttribute == null)
					continue;

				let attributeIndex = childAttribute.index;
				let addDiagnostic = (message: string, severity: DiagnosticSeverity, additionalInformation?: string) =>
				{
					let diagnostic: Diagnostic = {
						severity: severity,
						range: {
							start: textDocument.positionAt(attributeIndex),
							end: textDocument.positionAt(attributeIndex + attributeName.length)
						},
						message: message,
						source: kDiagnosticSource
					};

					if(additionalInformation != null && additionalInformation.length > 0)
					{
						diagnostic.relatedInformation = [{
							location: { uri: textDocument.uri, range: Object.assign ({}, diagnostic.range) },
							message: additionalInformation
						}];
					}

					diagnostics.push (diagnostic);
				};

				let attributeType = attributes[correctedAttributeName];

				if(!found || childAttribute.reDefinition) // invalid attribute
				{
					let message = invalidError;
					if(childAttribute.reDefinition)
						message = reDefError;
					else if(foundCaseInsensitive)
						message = wrongCaseWarning;

					let additionalInformation: string | undefined = undefined;
					if(foundCaseInsensitive)
						additionalInformation = `Did you mean "${correctedAttributeName}"?`;

					addDiagnostic (message, foundCaseInsensitive ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error, additionalInformation);
					if(attributeType != null && (found || foundCaseInsensitive))
						this.checkAttributeValue (diagnostics, textDocument, child, attributeType, attributeName, correctedAttributeName);
				}
				else if(tagName == "Delegate" && correctedAttributeName == "name" && child.attribs["form.name"] == null)
					addDiagnostic ("Did you mean \"form.name\"?", DiagnosticSeverity.Warning);
				else if(attributeType != null && (tagName != "foreach" || correctedAttributeName != "count"))
				{
					if(tagName == "Delegate" && correctedAttributeName == "style")
						addDiagnostic ("The Style needs to be defined by the referenced Form.", DiagnosticSeverity.Warning);
					else if(tagName == "Slider" && child.attribs["style"] == null && ["width", "height", "size"].includes (correctedAttributeName))
					{
						let widthSet = false;
						let heightSet = false;
						if(child.attribs["width"] != null)
							widthSet = true;
						else if(child.attribs["height"] != null)
							heightSet = true;
						else if(child.attribs["size"] != null)
						{
							let values = child.attribs["size"].split(",");
							if(values.length > 2)
							{
								widthSet = values[2].trim () != "-1";
								if(values.length > 3)
									heightSet = values[3].trim () != "-1";
							}
						}

						if(widthSet && heightSet)
							addDiagnostic (`Sliders with default style should not have both, width and height set. They define their size based on orientation and whether being used in a desktop or mobile context.`, DiagnosticSeverity.Warning);
					}

					// arbitrary values (e.g. property names) are allowed for the count attribute in foreach
					this.checkAttributeValue (diagnostics, textDocument, child, attributeType, attributeName, correctedAttributeName);
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkAttributeValue (diagnostics: Diagnostic[], textDocument: TextDocument, child: Element,
										attributeType: AttributeType, attributeName: string, correctedAttributeName: string)
	{
		let childAttributes = DocumentManager.findTagAttributes (child, DocumentManager.findTagText (child, textDocument.uri));
		let attributeValue = child.attribs[attributeName];
		if(attributeValue == null)
			return;

		let attributeValues = [attributeValue];
		if(attributeValue.indexOf ("$") != -1)
			attributeValues = SkinDefinitionParser.resolveVariable (textDocument.uri, child, attributeValues[0]);

		if(attributeValues.length == 0)
			attributeValues.push (attributeValue);

		let addDiagnostic = (info: TagAttributeInfo, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error,
							 additionalInformation?: string, customRange?: Range) =>
		{
			let result = this.createDiagnosticMessage (info, message, severity, additionalInformation ? { message: additionalInformation } : undefined, customRange);
			if(result != null)
				diagnostics.push (result);
		};

		let evalErrorAdded = false;
		for(let attributeValueIndex = 0; attributeValueIndex < attributeValues.length; attributeValueIndex++)
		{
			let info: TagAttributeInfo = {
				tag: child,
				textDocument: textDocument,
				attributes: childAttributes,
				attributeName: attributeName,
				correctedAttributeName: correctedAttributeName,
				attributeValue: attributeValues[attributeValueIndex],
				originalAttributeValue: attributeValue
			};

			// Use original value to prevent warnings if a variable resolves to an empty string.
			if(attributeValue.length == 0 && (attributeType != AttributeType.kString || attributeName == "name"))
			{
				addDiagnostic (info, info.attributeName + " has no value. Consider removing it.", DiagnosticSeverity.Warning);
				continue;
			}

			if(info.attributeValue.indexOf ("@eval:") > -1 || info.attributeValue.indexOf ("@select:") > -1)
			{
				let result = IntelliSenseProvider.evaluateExpression (info.attributeValue);
				info.attributeValue = result.result;
				for(let i = 0; i < result.errors.length; i++)
					addDiagnostic (info, result.errors[i].msg, DiagnosticSeverity.Error, result.errors[i].detail);
			}
			else if(child.name != "define" && !evalErrorAdded)
			{
				let values = ["@eval:", "@property:", "@select:"];
				for(let i in values)
				{
					let val = values[i];
					if(attributeValue.indexOf (val) > -1)
					{
						addDiagnostic (info, val + " is only allowed in attribute values of the <define> element.");
						evalErrorAdded = true;
					}
				}
			}

			if(child.name == "if" || child.name == "switch")
			{
				if(attributeName == "property" || attributeName == "defined" || attributeName == "not.defined")
				{
					if(!attributeValue.startsWith ("$")
						&& SkinDefinitionParser.lookupDefinition (textDocument.uri, DefinitionType.kVariable, child,
																  "$" + attributeValue, LookupDefinitionOptions.kForceExact).length > 0)
					{
						addDiagnostic (info, "This seems to be a variable. Did you mean $" + attributeValue + "?", DiagnosticSeverity.Warning);
					}
				}
			}
			else if((child.name == "foreach" || child.name == "styleselector") && attributeName == "variable" && !attributeValue.startsWith ("$"))
				addDiagnostic (info, "This variable should always start with a '$'.", DiagnosticSeverity.Warning);

			IntelliSenseProvider.performForeach (info.attributeValue, (value) =>
			{
				if(value.indexOf ("$") > -1)
					return; // do not check unresolved variables here. They might be defined by an outer scope.

				info.attributeValue = value;
				this.checkAttributeType (diagnostics, info, attributeType);
			});
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkAttributeType (diagnostics: Diagnostic[], info: TagAttributeInfo, attributeType: AttributeType)
	{
		if(info.attributeValue.indexOf ("@property:") > -1)
			return; // do not show errors for values that contain properties since they can resolve to anything

		let newDiagnostics: Diagnostic[] = [];
		let checksPerformed = 0;
		let failures = 0;
		let check = <T extends readonly unknown[]>(func: (info: TagAttributeInfo, ...args: T) => Diagnostic[] | Diagnostic | null, ...args: T) =>
		{
			let result = func.call (this, info, ...args);
			checksPerformed++;
			if(result != null)
			{
				if(!Array.isArray (result))
					result = [result];

				if(result.length > 0)
				{
					if(failures == 0) // only add first diagnostic. Subsequent checks are alternative validations and no new errors.
						newDiagnostics.push (...result);

					failures++;
				}
			}
		};

		if(attributeType & AttributeType.kBool)
			check (this.checkBoolean);
		if(attributeType & AttributeType.kInt)
			check (this.checkInteger);
		if(attributeType & AttributeType.kColor)
			check (this.checkColor);
		if(attributeType & AttributeType.kForm)
			check (this.checkForm);
		if(attributeType & AttributeType.kEnum)
			check (this.checkEnum, info.tag.name);
		if(attributeType & AttributeType.kFloat || attributeType & AttributeType.kFontSize || attributeType & AttributeType.kDuration)
			check (this.checkFloat, attributeType);
		if(attributeType & AttributeType.kSize || attributeType & AttributeType.kRect)
			check (this.checkRectOrSize, attributeType);
		if(attributeType & AttributeType.kPoint3D)
			check (this.checkPoint3D, attributeType);
		if(attributeType & AttributeType.kStyle)
		{
			check (this.checkDefinition, DefinitionType.kStyle);
			check (this.checkStringLiteral, "native");
		}
		if(attributeType & AttributeType.kStyleArray)
			check (this.checkStyleArray);
		if(attributeType & AttributeType.kImage || attributeType & AttributeType.kFont || attributeType & AttributeType.kShape)
		{
			let type = SkinDefinitionParser.mapAttributeTypeToDefinitionType (attributeType);
			if(type != null)
				check (this.checkDefinition, type);
		}
		if(attributeType & AttributeType.kUri) // check uri after shape to keep no definition errors instead of file not found
			check (this.checkUrl);
		if(attributeType & AttributeType.kStrForever)
			check (this.checkStringLiteral, "forever");
		if(attributeType & AttributeType.kStrNone)
			check (this.checkStringLiteral, "none");

		if(failures == checksPerformed) // none of the possible types was successfully checked
			diagnostics.push (...newDiagnostics);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkStringLiteral (info: TagAttributeInfo, str: string)
	{
		if(info.attributeValue != str)
			return this.createDiagnosticMessage (info, `"${info.attributeValue}" does not match "${str}".`);

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkEnum (info: TagAttributeInfo, tag: string)
	{
		let attributes: { [id: string]: string | undefined } = {};
		for(let a in info.attributes)
		{
			let attribute = info.attributes[a];
			if(attribute != null)
			{
				if(a == info.attributeName)
					attributes[info.correctedAttributeName] = attribute.value;
				else
					attributes[a] = attribute.value;
			}
		}

		const validEntries = ClassModelManager.findValidEnumEntries (tag, info.correctedAttributeName, attributes);

		return this.checkArrayType (info, (value) => {
			return validEntries.indexOf (value) > -1 || validEntries.indexOf (value.replace (/_/g, "")) > -1;
		},
		(value) => {
			return `"${value}" is an invalid option in "${info.attributeName}" for "${tag}".`;
		});
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkBoolean (info: TagAttributeInfo)
	{
		if(["true", "false"].indexOf (info.attributeValue.toLowerCase ()) == -1)
			return this.createDiagnosticMessage (info, `"${info.attributeValue}" is not a boolean value.`);

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkInteger (info: TagAttributeInfo)
	{
		let check = (val: string) => { return new RegExp ("^" + intRegex + "$").test (val); };
		if(check (info.attributeValue) == false)
		{
			if(check (info.attributeValue.trim ()) == true)
				return this.createDiagnosticMessage (info, `"${info.attributeValue}" contains spaces.`, DiagnosticSeverity.Warning);
			else
				return this.createDiagnosticMessage (info, `"${info.attributeValue}" is not an integer value.`);
		}

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkFloat (info: TagAttributeInfo, type: AttributeType)
	{
		let prefix = "";
		let unitAddition = "";

		if(type & AttributeType.kFontSize)
			prefix = "(?:\\+)?";

		if(type & AttributeType.kDuration)
			unitAddition = "(?:\\s*ms)?";

		let check = (val: string) => { return new RegExp ("^" + prefix + floatRegex + unitAddition + "$").test (val); };
		if(check (info.attributeValue) == false)
		{
			if(check (info.attributeValue.trim ()) == true)
				return this.createDiagnosticMessage (info, `"${info.attributeValue}" contains spaces.`, DiagnosticSeverity.Warning);
			else
				return this.createDiagnosticMessage (info, `"${info.attributeValue}" is not a float value.`);
		}

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkRectOrSize (info: TagAttributeInfo, type: AttributeType)
	{
		let numberRegex = "\\s*" + floatRegex + "\\s*";
		let optional = "";
		if(type & AttributeType.kSize)
			optional = "?";

		let regex = "^" + numberRegex + "(?:," + numberRegex + ")" + optional + "(?:," + numberRegex + ")" + optional + "(?:," + numberRegex + ")" + optional + "$";
		if(new RegExp (regex).test (info.attributeValue) == false)
		{
			let typeName = ClassModelManager.typeToString (type);
			let expectedFormat = `"<left>,<top>,<width>,<height>"`;
			return this.createDiagnosticMessage (info, `"${info.attributeValue}" is not a ` + typeName + ` value. ` +
												`(Expected format: ` + expectedFormat + `)`);
		}

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkPoint3D (info: TagAttributeInfo, type: AttributeType)
	{
		let numberRegex = "\\s*" + floatRegex + "\\s*";
		let regex = "^" + numberRegex + "," + numberRegex + "," + numberRegex + "$";
		if(new RegExp (regex).test (info.attributeValue) == false)
		{
			let typeName = ClassModelManager.typeToString (type);
			let expectedFormat = `"<x>,<y>,<z>"`;
			return this.createDiagnosticMessage (info, `"${info.attributeValue}" is not a ` + typeName + ` value. ` +
												`(Expected format: ` + expectedFormat + `)`);
		}

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkColor (info: TagAttributeInfo)
	{
		let isValid = false;
		let color = IntelliSenseProvider.parseColor (info.attributeValue);
		if(color != null)
		{
			isValid = true;
			let colors = IntelliSenseProvider.getColorsInDocument (info.textDocument.uri);
			if(colors == null)
				colors = [];

			let attribute = info.attributes[info.attributeName];
			if(attribute != null)
			{
				colors.push (ColorInformation.create (
					this.getRangeForAttributeValue (info.textDocument, attribute, info.attributeValue),
					color
				));
			}

			IntelliSenseProvider.setColorsInDocument (info.textDocument.uri, colors);
		}

		if(!isValid)
		{
			let defaultColors = ClassModelManager.getDefaultColors ();
			for(let i = 0; i < defaultColors.length; i++)
			{
				if(defaultColors[i].name == info.attributeValue)
				{
					isValid = true;
					break;
				}
			}
		}

		if(!isValid)
			return this.checkDefinition (info, DefinitionType.kColor);

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkDefinition (info: TagAttributeInfo, type: DefinitionType)
	{
		if(info.attributeValue.length > 0 && !SkinDefinitionParser.isDefined (info.textDocument.uri, type, info.attributeValue))
			return this.createDiagnosticMessage (info, `No definition found for ${this.definitionTypeToString (type)} "${info.attributeValue}".`);

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkArrayType (info: TagAttributeInfo, checkFunction: (value: string) => boolean, messageFunction: (failedValue: string) => string)
	{
		let result: Diagnostic[] = [];
		let values = info.attributeValue.trim ().split (/(\s+)/);
		let valueStart = 0;
		for(let i = 0; i < values.length; i++)
		{
			let valueLength = values[i].length;
			let value = values[i].trim ();
			if(value.length > 0)
			{
				if(!checkFunction (value))
				{
					let attribute = info.attributes[info.attributeName];
					if(attribute == null)
						continue;

					let diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Error,
						range: this.getRangeForAttributeValue (info.textDocument, attribute, info.originalAttributeValue),
						message: messageFunction (value),
						source: kDiagnosticSource
					};

					result.push (diagnostic);
				}
			}

			valueStart += valueLength;
		}

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkStyleArray (info: TagAttributeInfo)
	{
		return this.checkArrayType (info, (value) => {
			return SkinDefinitionParser.isDefined (info.textDocument.uri, DefinitionType.kStyle, value);
		},
		(value) => {
			return `No definition found for style "${value}".`;
		});
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkForm (info: TagAttributeInfo)
	{
		const uri = info.textDocument.uri;
		const val = info.attributeValue;
		let result: Diagnostic[] = [];
		// A name can also be resolved in code using a controller. We cannot check that.
		if(info.correctedAttributeName == "form.name")
		{
			if(SkinDefinitionParser.isDefined (uri, DefinitionType.kForm, val, false) &&
				!SkinDefinitionParser.isDefined (uri, DefinitionType.kForm, val, true))
			{
				let d = this.createDiagnosticMessage (info, `No definition found for form "${val}". Did you mean "${SkinDefinitionParser.qualifyName (uri, val)}"?`);
				if(d != null)
					result.push (d);
			}
		}

		if(SkinDefinitionParser.isDefined (uri, DefinitionType.kForm, val))
		{
			let unresolvedVars = SkinDefinitionParser.getUnresolvedVariablesForForm (uri, val);
			for(let i = 0; i < unresolvedVars.length; i++)
			{
				let definitions = SkinDefinitionParser.lookupDefinition (uri, DefinitionType.kVariable, info.tag, unresolvedVars[i].name);
				if(definitions.length == 0)
				{
					let varName = unresolvedVars[i].name;
					let index = varName.substring (1).search (/[^\p{Letter}0-9]/u) + 1;
					if(index > 0)
						varName = varName.substring (0, index);

					let d = this.createDiagnosticMessage (info, `No definition found for variable "${varName}".`, DiagnosticSeverity.Error,
														  { message: "Requested here", location: unresolvedVars[i].scope });
					if(d != null)
						result.push (d);
				}
			}
		}

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static checkUrl (info: TagAttributeInfo)
	{
		if(info.attributeValue.startsWith ("https://")
			|| info.attributeValue.startsWith ("http://")
			|| info.attributeValue.startsWith ("local://$")
			|| info.attributeValue.startsWith ("object://"))
			return null; // don't try to resolve web urls as local paths

		let filePath = SkinDefinitionParser.resolveUri (info.attributeValue, info.textDocument.uri);
		if(!fs.existsSync (filePath) || (filePath.lastIndexOf ("/") >= filePath.lastIndexOf (".") && fs.statSync (filePath).isDirectory ()))
			return this.createDiagnosticMessage (info, `File not found: "${filePath}".`);

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getRangeForAttributeValue (textDocument: TextDocument, tagAttribute: TagAttribute, attributeValue: string)
	{
		return {
			start: textDocument.positionAt (tagAttribute.valueIndex),
			end: textDocument.positionAt (tagAttribute.valueIndex + attributeValue.length)
		};
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static createDiagnosticMessage (info: TagAttributeInfo, errorMessage: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error,
											additionalInformation?: { message: string, location?: Location }, customRange?: Range)
	{
		let attribute = info.attributes[info.attributeName];
		if(attribute != null)
		{
			let range = customRange;
			if(range == null)
				range = this.getRangeForAttributeValue (info.textDocument, attribute, info.originalAttributeValue);

			let diagnostic: Diagnostic = {
				severity: severity,
				range: range,
				message: errorMessage,
				source: kDiagnosticSource
			};

			if(this.hasDiagnosticRelatedInformationCapability && additionalInformation != null)
			{
				let additionalLocation = additionalInformation.location;
				if(additionalLocation == null)
				{
					additionalLocation = {
						uri: info.textDocument.uri,
						range: Object.assign ({}, diagnostic.range)
					};
				}

				diagnostic.relatedInformation = [
					{
						location: additionalLocation,
						message: additionalInformation.message
					}
				];
			}

			return diagnostic;
		}

		return null;
	}
}
