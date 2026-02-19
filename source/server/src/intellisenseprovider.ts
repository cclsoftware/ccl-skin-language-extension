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
// Filename    : server/src/intellisenseprovider.ts
// Description : IntelliSense Provider
//
//************************************************************************************************

import {
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	Hover,
	Position,
	ColorInformation,
	Color,
	Location
} from 'vscode-languageserver';

import { Range, TextDocument } from 'vscode-languageserver-textdocument';
import { Element } from 'domhandler';
import convert from 'color-convert';
import { ClassModelManager, AttributeType, StyleDocumentation } from './classmodelmanager';
import { DefinitionType, LookupDefinitionOptions, SkinDefinitionParser } from './skindefinitionparser';
import * as fs from 'fs';
import { SkinExpressionParser } from './skinexpressionparser';
import { FilesystemHelper } from './filesystemhelper';
import { DocumentManager, TokenType } from './documentmanager';
import { kThemePrefix } from './variableresolver';
import * as he from 'he';

//************************************************************************************************
// Definitions
//************************************************************************************************

type CompletionInfoContext = {
	url: string,
	position: Position,
	tag: Element,
	attributes: { name: string, value: string }[] | undefined,
	attributeName: string,
	attributeValue: string,
	fullAttributeValue: string,
	completionItems: CompletionItem[]
};

const kU8Max = 255;

//************************************************************************************************
// IntelliSenseProvider
//************************************************************************************************

export class IntelliSenseProvider
{
	public static readonly kTriggerCharacters = [".", "/", "<", " ", "\"", "$", "[", ":", "@", "?"];

	private static colorValues: { [id: string]: ColorInformation[] | undefined } = {};

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getColorsInDocument (uri: string)
	{
		return this.colorValues[uri];
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static setColorsInDocument (uri: string, colors: ColorInformation[])
	{
		this.colorValues[uri] = colors;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static resolveElementName (tag: Element): { name: string, success: boolean }
	{
		if(tag.attribs["layout.class"] != null)
		{
			let layoutClass = tag.attribs["layout.class"];
			let elemNames = ClassModelManager.findSkinElementDefinitions (layoutClass);
			let found = false;
			for(let i = 0; i < elemNames.length; i++)
			{
				if(elemNames[i].toLowerCase () == layoutClass.toLowerCase ())
				{
					layoutClass = elemNames[i];
					found = true;
					break;
				}
			}

			if(found)
				return { name: layoutClass, success: true };
			else
				return { name: tag.name, success: false };
		}

		return { name: tag.name, success: true };
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static performForeach (foreachExpression: string, func: (value: string) => void)
	{
		if(foreachExpression.indexOf ("@foreach:") > -1)
		{
			let result = this.splitExpression (foreachExpression, "@foreach:");
			if(result.expression.startsWith ("[") && result.expression.endsWith ("]"))
			{
				let parts = result.expression.substring (1, result.expression.length - 1).split (",");
				for(let i = 0; i < parts.length; i++)
				{
					this.performForeach (result.prefix + parts[i] + result.postfix, (value) =>
					{
						func (value);
					});
				}
			}
			else
			{
				let parts = result.expression.split (",");
				if(parts.length == 2 && SkinDefinitionParser.isNumeric (parts[0]) && SkinDefinitionParser.isNumeric (parts[1]) && +parts[1] <= 100)
				{
					for(let i = 0; i < +parts[1]; i++)
					{
						this.performForeach (result.prefix + (+parts[0] + i) + result.postfix, (value) =>
						{
							func (value);
						});
					}
				}
				else
					func (foreachExpression);
			}
		}
		else
			func (foreachExpression);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static splitExpression (value: string, keyword: string): { prefix: string, expression: string, postfix: string }
	{
		let keywordIndex = value.indexOf (keyword);
		if(keywordIndex == -1)
			return { prefix: value, expression: "", postfix: "" };

		let prefix = value.substring (0, keywordIndex);
		let expressionEndIndex = -1;
		if(value.indexOf (keyword + "(") > -1)
		{
			let openParens = 1;
			expressionEndIndex = keywordIndex + keyword.length + 1;
			for(; expressionEndIndex < value.length; expressionEndIndex++)
			{
				if(value[expressionEndIndex] == "(")
					openParens++;
				else if(value[expressionEndIndex] == ")")
					openParens--;

				if(openParens == 0)
					break;
			}
		}
		if(expressionEndIndex == -1)
			expressionEndIndex = value.length;

		let postfix = value.substring (expressionEndIndex + 1);
		let expression = value.substring (keywordIndex + keyword.length, expressionEndIndex);
		if(expression.startsWith ("("))
			expression = expression.substring (1);

		if(expression.indexOf (keyword) > -1)
		{
			let result = this.splitExpression (expression, keyword);
			result.expression = result.prefix + result.expression + result.postfix;
			result.prefix = prefix;
			result.postfix = postfix;
			return result;
		}

		return { prefix: prefix, expression: expression, postfix: postfix };
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static evaluateExpression (value: string): { result: string, errors: { msg: string, detail: string }[] }
	{
		const kEvalKeyword = "@eval:";
		const kSelectKeyword = "@select:";

		let errors: { msg: string, detail: string }[] = [];
		let result = this.evaluateExpressionInternal (value, kEvalKeyword, (expression) =>
		{
			let result = SkinExpressionParser.evaluate (expression);
			if(result.error != null)
				errors.push ({ msg: result.error, detail: "In expression \"" + value + "\"." });

			if(result.value != null)
				return result.value + "";

			return "";
		}, errors);

		result = this.evaluateExpressionInternal (result, kSelectKeyword, (expression) =>
		{
			let parts = expression.split (":");
			if(parts.length != 2)
				return expression;

			let index = +parts[0];
			return parts[1].split (",")[index];
		}, errors);

		return { result: result, errors: errors };
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static evaluateExpressionInternal (value: string, keyword: string,
		evaluate: (expression: string) => string, errors: { msg: string, detail: string }[]): string
	{
		let extractedExpression = this.splitExpression (value, keyword);
		if(extractedExpression.expression.length == 0)
			return extractedExpression.prefix + extractedExpression.postfix;

		let canBeEvaluated = (expression: string) =>
		{
			return expression.indexOf ("@") == -1  // cannot resolve @property:
				&& expression.indexOf ("$") == -1; // cannot evaluate unresolved variable
		};

		let resultValue: { result: string, errors: { msg: string, detail: string }[] } = { result: "", errors: [] };
		if(extractedExpression.expression.indexOf (keyword) > -1)
		{
			resultValue = this.evaluateExpression (extractedExpression.expression);
			errors = errors.concat (resultValue.errors);
		}
		else
		{
			if(!canBeEvaluated (extractedExpression.expression))
				return extractedExpression.prefix + keyword + "(" + extractedExpression.expression + ")" + extractedExpression.postfix;
			else
				resultValue.result = evaluate (extractedExpression.expression);
		}

		if(extractedExpression.prefix.length == 0 && extractedExpression.postfix.length == 0)
			return resultValue.result;

		let newExpression = extractedExpression.prefix + resultValue.result + extractedExpression.postfix;
		if(newExpression.indexOf (keyword) == -1 && canBeEvaluated (newExpression))
			newExpression = keyword + "(" + newExpression + ")";

		let result = this.evaluateExpression (newExpression);
		errors = errors.concat (result.errors);

		return result.result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static parseColor (colorString: string): Color | null
	{
		const hexRegex = "[0-9a-fA-F]";
		const hexSingleRegex = "(" + hexRegex + ")";
		const hexPairRegex = "(" + hexRegex + hexRegex + ")";
		const floatRegex = "(\\d+(?:\\.\\d+)?)";
		const hslvString = "(?:hs[vl])a?" +
						  "\\(" +
							  floatRegex + "," + floatRegex + "%?," + floatRegex + "%?(?:," + floatRegex + ")?" +
						  "\\)";
		const rgbString = "(?:rgb)a?" +
						  "\\(" +
							  "([0-9]+),([0-9]+),([0-9]+)(?:,([0-9]+))?" +
						  "\\)";
		const rgbPercentString = "(?:rgb)a?" +
						  "\\(" +
							  floatRegex + "%," + floatRegex + "%," + floatRegex + "%(?:," + floatRegex + "%)?" +
						  "\\)";
		const hexString = "#" + hexPairRegex + hexPairRegex + hexPairRegex + "(?:" + hexPairRegex + ")?";
		const hexShortString = "#" + hexSingleRegex + hexSingleRegex + hexSingleRegex + "(?:" + hexSingleRegex + ")?";
		let regexResult = new RegExp ("^" + hslvString + "$").exec (colorString);
		if(regexResult != null && regexResult.length >= 4)
		{
			let h = +regexResult[1];
			let s = +regexResult[2];
			let l = +regexResult[3];
			let a = 1;
			if(regexResult.length > 4 && regexResult[4] != null)
				a = +regexResult[4] / 100;

			let rgb = convert.hsl.rgb.raw ([h, s, l]);
			if(colorString.startsWith("hsv"))
				rgb = convert.hsv.rgb.raw ([h, s, l]);

			return { red: rgb[0] / kU8Max, green: rgb[1] / kU8Max, blue: rgb[2] / kU8Max, alpha: a };
		}

		regexResult = new RegExp ("^" + rgbString + "$").exec (colorString);
		if(regexResult != null && regexResult.length >= 4)
		{
			let a = 1;
			if(regexResult.length > 4 && regexResult[4] != null)
				a = +regexResult[4] / 100;

			return { red: +regexResult[1] / kU8Max, green: +regexResult[2] / kU8Max, blue: +regexResult[3] / kU8Max, alpha: a };
		}

		regexResult = new RegExp ("^" + rgbPercentString + "$").exec (colorString);
		if(regexResult != null && regexResult.length >= 4)
		{
			let a = 1;
			if(regexResult.length > 4 && regexResult[4] != null)
				a = +regexResult[4] / 100;

			return { red: +regexResult[1] / 100, green: +regexResult[2] / 100, blue: +regexResult[3] / 100, alpha: a };
		}

		let defaultColors = ClassModelManager.getDefaultColors ();
		for(let i = 0; i < defaultColors.length; i++)
		{
			if(defaultColors[i].name == colorString)
			{
				colorString = defaultColors[i].hexValue;
				break;
			}
		}

		regexResult = new RegExp ("^" + hexString + "$").exec (colorString);
		if(regexResult == null || regexResult.length < 4)
			regexResult = new RegExp ("^" + hexShortString + "$").exec (colorString);

		if(regexResult != null && regexResult.length >= 4)
		{
			let nonNullResult = regexResult;
			let getNormalized = (index: number) =>
			{
				let s = nonNullResult[index];
				if(s.length == 1)
					s += s;

				return parseInt (Number ("0x" + s) + "", 10) / kU8Max;
			}

			let a = 1;
			if(regexResult.length > 4 && regexResult[4] != null)
				a = getNormalized (4);

			return { red: getNormalized (1), green: getNormalized (2), blue: getNormalized (3), alpha: a };
		}

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static colorToString (color: Color, uri: string, range: Range)
	{
		let currentString = DocumentManager.getTextFromRange (uri, range);
		if(currentString == null)
			return null;

		if(currentString.startsWith ("hsl"))
		{
			let hsl = convert.rgb.hsl ([color.red * kU8Max, color.green * kU8Max, color.blue * kU8Max]);
			let hslString = hsl[0] + "," + hsl[1] + "," + hsl[2];
			if(color.alpha < 1)
				hslString += "," + Math.round (color.alpha * 100);

			return "hsl(" + hslString + ")";
		}
		else if(currentString.startsWith ("hsv"))
		{
			let hsv = convert.rgb.hsv ([color.red * kU8Max, color.green * kU8Max, color.blue * kU8Max]);
			let hsvString = hsv[0] + "," + hsv[1] + "," + hsv[2];
			if(color.alpha < 1)
				hsvString += "," + Math.round (color.alpha * 100);

			return "hsv(" + hsvString + ")";
		}
		else if(currentString.startsWith ("rgb"))
		{
			let scaleFactor = kU8Max;
			let suffix = "";
			let alpha = "";
			if(color.alpha < 1)
				alpha = "," + Math.round (color.alpha * 100);

			if(currentString.indexOf ("%") > -1)
			{
				scaleFactor = 100;
				suffix = "%";
				alpha += suffix;
			}

			let c = (rawComponent: number) =>
			{
				return `${Math.round (rawComponent * scaleFactor)}${suffix}`;
			};

			return `rgb(${c (color.red)},${c (color.green)},${c (color.blue)}${alpha})`;
		}
		else // assume hex format (this is also used for well known colors like "white"
		{
			let getHex = (value: number) =>
			{
				return (Math.round (value * kU8Max)).toString (16).padStart (2, '0');
			}

			let result = "#" + getHex (color.red) + getHex (color.green) + getHex (color.blue);
			if(color.alpha < 1)
				result += getHex (color.alpha);

			return result;
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getDocumentation (type: TokenType, tagName: string, attributeName?: string, attributeValue?: string,
		tagInfo?: { uri: string, tag: Element, valueBeforeCursor: string })
	{
		let docs: {
			inheritance?: string[],
			brief: string,
			detailed: string,
			code: string,
			type?: string,
			styles?: {
				brief: string,
				detailed: string,
				values: StyleDocumentation[]
			}
		} | null = null;

		let additionalInfo = "";
		if(type == TokenType.kTagName)
		{
			docs = ClassModelManager.findSkinElementDocumentation (tagName);
			if(docs != null && docs.styles != null)
			{
				if(docs.styles.brief.length > 0)
					additionalInfo += "\n" + docs.styles.brief + "\n" + docs.styles.detailed + "\n";

				if(docs.styles.values.length > 0)
					additionalInfo += "| Style | Description |\n| --- | --- |\n";

				for(let i = 0; i < docs.styles.values.length; i++)
				{
					additionalInfo += "| " + docs.styles.values[i].name + " (" + docs.styles.values[i].type + ") | ";
					let description = docs.styles.values[i].description;
					if(description != null)
					{
						additionalInfo += description.brief;
						if(description.detailed.length > 0)
							additionalInfo += " - *" + description.detailed + "*";
					}

					additionalInfo += " |\n";
				}
			}
		}
		else if(type == TokenType.kAttributeName && attributeName != null)
			docs = ClassModelManager.findAttributeDocumentation (tagName, attributeName);
		else if(type == TokenType.kAttributeValue && attributeName != null && attributeValue != null)
		{
			let type = ClassModelManager.findAttributeType (tagName, attributeName).type;
			let variableStart = -1;
			if(tagInfo != null)
				variableStart = tagInfo.valueBeforeCursor.lastIndexOf ("$");

			if(variableStart > -1)
			{
				let end = -1;
				for(let i = variableStart + 1; i < attributeValue.length; i++)
				{
					if(attributeValue[i].match (/[a-zA-Z0-9\.]/) == null)
					{
						end = i;
						break;
					}
				}
				if(end == -1)
					end = attributeValue.length;

				attributeValue = attributeValue.substring (variableStart, end);
			}

			if(tagInfo != null)
			{
				let resolvedValues = SkinDefinitionParser.resolveVariable (tagInfo.uri, tagInfo.tag, attributeValue);
				if(attributeValue.indexOf ("$") > -1)
				{
					let minEndIndex = 0;
					if(variableStart > -1)
					{
						for(let i = 0; i < resolvedValues.length; i++)
						{
							let resolvedValue = resolvedValues[i];
							for(let equalCharIndex = 0; equalCharIndex < Math.min (attributeValue.length, resolvedValue.length); equalCharIndex++)
							{
								if(attributeValue[attributeValue.length - 1 - equalCharIndex] != resolvedValue[resolvedValue.length - 1 - equalCharIndex])
								{
									minEndIndex = Math.min (minEndIndex, equalCharIndex);
									break;
								}
							}
						}
					}

					if(resolvedValues.length > 0)
						additionalInfo += "**Possible values for " + attributeValue.substring (0, attributeValue.length - minEndIndex).replaceAll ("*", "\\*") + ":**\n";

					let values: string[] = [];
					for(let i = 0; i < resolvedValues.length; i++)
					{
						let resolvedValue = resolvedValues[i];
						resolvedValue = resolvedValue.substring (0, resolvedValue.length - minEndIndex);

						if(resolvedValue.indexOf ("@eval:") > -1 || resolvedValue.indexOf ("@select:") > -1)
							resolvedValue = this.evaluateExpression (resolvedValue).result;

						this.performForeach (resolvedValue, (value) =>
						{
							let resultIndex = resolvedValues.indexOf (value);
							if(resultIndex > -1 && resultIndex < i)
								return; // skip if the evaluated result is equal to an already added result

							if(values.indexOf (value) == -1)
								values.push (value);
						});
					}

					values.sort ();
					for(let i = 0; i < values.length; i++)
						additionalInfo += ` - "${values[i]}"\n`;
				}

				for(let i = 0; i < resolvedValues.length; i++)
				{
					let currentValue = resolvedValues[i];
					let imageAdded = false;
					if(type & AttributeType.kUri || type == AttributeType.kImage)
					{
						if(currentValue.endsWith (".png") || currentValue.endsWith (".svg") ||
							currentValue.endsWith (".jpg") || currentValue.endsWith (".jpeg") ||
							currentValue.endsWith (".webp"))
						{
							let resolved = "file://" + SkinDefinitionParser.resolveUri (currentValue, tagInfo.uri);
							if(fs.existsSync (new URL (resolved)))
							{
								additionalInfo += "![" + resolved + "](" + resolved + "|width=80 '" + resolved + "')";
								imageAdded = true;
							}
						}
					}

					if(!imageAdded && type & AttributeType.kShape)
					{
						if(!SkinDefinitionParser.isDefined (tagInfo.uri, DefinitionType.kShape, currentValue))
						{
							let resolved = SkinDefinitionParser.resolveUri (currentValue, tagInfo.uri);
							if(resolved != currentValue && fs.existsSync (resolved))
								additionalInfo += resolved;
						}
					}
					else if(type == AttributeType.kEnum)
					{
						let enumEntryStart = tagInfo.valueBeforeCursor.lastIndexOf (" ") + 1;
						if(enumEntryStart == -1)
							enumEntryStart = 0;

						let enumEntryEnd = attributeValue.indexOf (" ", enumEntryStart);
						if(enumEntryEnd == -1)
							enumEntryEnd = attributeValue.length;

						let enumEntry = attributeValue.substring (enumEntryStart, enumEntryEnd);
						docs = ClassModelManager.findEnumDocumentation (tagName, attributeName, enumEntry);
					}
				}
			}
			else if (type == AttributeType.kEnum)
				docs = ClassModelManager.findEnumDocumentation (tagName, attributeName, attributeValue);
		}

		if(docs == null && additionalInfo.length == 0)
			return;

		let brief = "";
		let docsMarkdown = "";
		if(docs != null)
		{
			brief = he.encode (docs.brief);

			let docString = "";
			if(docs.detailed.length > 0)
			{
				if(docString.length > 0)
					docString += "\n";

				docString += docs.detailed;
			}

			if(docs.type != null)
				docString += "\n\nType: " + docs.type;

			let code = "";
			if(docs.code.length > 0)
			{
				if(docString.length > 0)
					docString += "\n";

				code = "```xml\n" + docs.code + "\n```";
			}

			docsMarkdown = he.encode (docString) + code;
		}

		let detailed = docsMarkdown;
		if(detailed.length > 0 && additionalInfo.length > 0)
			detailed += "\n";

		return {
			inheritance: docs?.inheritance,
			brief: brief,
			detailed: detailed + he.encode (additionalInfo)
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getHoverInformation (params: TextDocumentPositionParams): Hover | undefined
	{
		let token = DocumentManager.findTokenAtPosition (params.textDocument.uri, params.position);
		if(token == null)
			return;

		let attributeName: string | undefined;
		let attributeValue: string | undefined;
		if("attributeIndex" in token && token.attributeIndex != null && token.attributeIndex >= 0)
		{
			attributeName = token.attributes[token.attributeIndex].name;
			attributeValue = token.attributes[token.attributeIndex].value;
		}

		let tagInfo: { uri: string, tag: Element, valueBeforeCursor: string } | undefined;
		if("valueBeforeCursor" in token && token.valueBeforeCursor != null)
			tagInfo = { uri: params.textDocument.uri, tag: token.tag, valueBeforeCursor: token.valueBeforeCursor };

		let docs = this.getDocumentation (token.type, token.tag.name, attributeName, attributeValue, tagInfo);
		if(docs != null)
		{
			let value = "";
			if(docs.inheritance != null && docs.inheritance.length > 1)
				value += "### " + docs.inheritance[0] + " (" + docs.inheritance[1] + ")";

			if(docs.brief.length > 0)
			{
				if(value.length > 0)
					value += "\n\n";

				value += "**" + docs.brief + "**";
			}

			if(value.length > 0 && docs.detailed.length > 0)
				value += "\n\n";

			return {
				contents: {
					kind: "markdown",
					value: value + docs.detailed
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getCompletionInformation (textDocumentPosition: TextDocumentPositionParams): CompletionItem[]
	{
		let uri = textDocumentPosition.textDocument.uri;
		let document = DocumentManager.getCurrentDocument (uri, true);
		if(document == null)
			return [];

		const index = DocumentManager.getIndexFromPosition (document.text, textDocumentPosition.position);
		let latestChar = "";
		let charBefore = "";
		let openingIndex = document.text.lastIndexOf ("<", index - 1);
		let closingIndex = document.text.lastIndexOf (">", index - 1);
		if(index > 1 && document.text.length > 1)
		{
			latestChar = document.text.substring (index - 1, index);
			if(index > 2 && document.text.length > 2)
				charBefore = document.text.substring (index - 2, index - 1);

			if(charBefore != "<")
			{
				if(latestChar == "\"" || latestChar == "/")
				{
					let tagString = document.text.substring (openingIndex, index);
					let isWithinQuotes = false;
					for(let i = 0; i < tagString.length; i++)
					{
						if(tagString[i] == "\"")
							isWithinQuotes = !isWithinQuotes;
					}
					if(!isWithinQuotes)
						return [];
				}
			}
		}

		let token = DocumentManager.findTokenAtPosition (uri, textDocumentPosition.position);
		if(token == null)
			return [];

		// Prevent autocomplete if the latest tag opening is before the latest tag closing
		// i.e. we are not within the < > of a tag
		if(token.type == TokenType.kTagName && openingIndex <= closingIndex)
			return [];

		let context: CompletionInfoContext = {
			url: uri,
			position: textDocumentPosition.position,
			tag: token.tag,
			attributes: "attributes" in token ? token.attributes : undefined,
			attributeName: "",
			attributeValue: "",
			fullAttributeValue: "",
			completionItems: []
		};

		if("attributeIndex" in token && token.attributeIndex != null && token.attributeIndex >= 0)
		{
			context.attributeName = token.attributes[token.attributeIndex].name;
			context.attributeValue = token.valueBeforeCursor.substring (token.valueBeforeCursor.lastIndexOf (" ") + 1);
			context.fullAttributeValue = token.attributes[token.attributeIndex].value;
		}

		if(token.type == TokenType.kAttributeName)
			this.getAttributeNameCompletionInformation (context);
		else if(token.type == TokenType.kAttributeValue)
			this.getAttributeValueCompletionInformation (context);
		else if(token.type == TokenType.kTagName)
			this.getTagNameCompletionInformation (context);

		return context.completionItems;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getAttributeNameCompletionInformation (context: CompletionInfoContext)
	{
		let tagName = this.resolveElementName (context.tag).name;
		let names = ClassModelManager.findValidAttributes (tagName);
		for(let name in names)
		{
			if(name.indexOf (context.attributeName) > -1)
			{
				let nameAlreadyUsed = false;
				if(context.attributes != null)
				{
					for(let i = 0; i < context.attributes.length; i++)
					{
						if(context.attributes[i].name == name)
						{
							nameAlreadyUsed = true;
							break;
						}
					}
				}

				if(!nameAlreadyUsed)
				{
					let label = name;
					if(context.attributeName.indexOf (".") > -1 && label.startsWith (context.attributeName))
						label = label.substring (context.attributeName.lastIndexOf (".") + 1);

					context.completionItems.push ({
						label: label,
						kind: CompletionItemKind.Field,
						data: { type: TokenType.kAttributeName, tagName: tagName, name: name }
					});
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static addValueCompletion (context: CompletionInfoContext, label: string, kind: CompletionItemKind,
									   attributeType: AttributeType | undefined, value?: any)
	{
		if(value == undefined)
			value = label;

		let tagName = this.resolveElementName (context.tag).name;
		context.completionItems.push ({
			label: label,
			kind: kind,
			data: {
				type: TokenType.kAttributeValue,
				valueType: attributeType,
				tagName: tagName,
				name: context.attributeName,
				value: value
			}
		});
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getAttributeValueCompletionInformation (context: CompletionInfoContext)
	{
		if(context.attributeName.length > 0)
		{
			let tagName = this.resolveElementName (context.tag).name;
			let attributeType = ClassModelManager.findValidAttributes (tagName)[context.attributeName];
			if(attributeType != null)
			{
				if(attributeType & AttributeType.kEnum)
					this.getEnumCompletionInformation (context);
				if(attributeType & AttributeType.kColor)
					this.getColorCompletionInformation (context);
				if(attributeType & AttributeType.kStyle || attributeType & AttributeType.kStyleArray || attributeType & AttributeType.kImage)
					this.getStyleOrImageCompletionInformation (context, attributeType);
				if(attributeType & AttributeType.kUri)
					this.getUriCompletionInformation (context);
				if(attributeType & AttributeType.kShape)
					this.getCompletionInformationForType (context, DefinitionType.kShape);
				if(attributeType & AttributeType.kFont)
					this.getCompletionInformationForType (context, DefinitionType.kFont);
				if(attributeType & AttributeType.kForm)
					this.getCompletionInformationForType (context, DefinitionType.kForm, context.attributeName == "form.name");
				if(attributeType & AttributeType.kBool)
					this.getBoolCompletionInformation (context);
			}

			if(context.completionItems.length == 0)
			{
				let values: string[] = [];
				let completionItemKind: CompletionItemKind = CompletionItemKind.Value;
				let searchTerm = context.attributeValue;
				let addVariablePrefix = false;
				if(tagName == "if" || tagName == "switch")
				{
					if(context.attributeName == "property" || context.attributeName == "defined" || context.attributeName == "not.defined")
					{
						if(searchTerm.length == 0)
						{
							addVariablePrefix = true;
							searchTerm = "$";
						}
					}
				}
				if(searchTerm.indexOf ("$") > -1)
				{
					let vars = SkinDefinitionParser.findDefinitions (context.url, DefinitionType.kVariable, context.tag, searchTerm);
					for(let i = 0; i < vars.length; i++)
					{
						let def = vars[i].definition;
						if(tagName == "define" && vars[i].definition == context.attributeName)
							continue; // avoid defining variables as their own definition

						if(addVariablePrefix)
							def = "$" + def;

						values.push (def);
					}

					// if the attribute can contain numbers
					let numberTypesMask = AttributeType.kInt
						| AttributeType.kFloat
						| AttributeType.kSize
						| AttributeType.kRect
						| AttributeType.kPoint
						| AttributeType.kFontSize
						| AttributeType.kDuration
						| AttributeType.kString;

					if(attributeType != null && (attributeType & numberTypesMask))
					{
						if(kThemePrefix.startsWith (searchTerm.substring (1)))
							values.push (kThemePrefix);
						else
						{
							let themeMetric = "";
							if(searchTerm.substring (1).startsWith (kThemePrefix + "."))
								themeMetric = searchTerm.substring (kThemePrefix.length + 2); // + 2 for $ and .

							let metrics = ClassModelManager.getThemeMetrics ();
							for(let i = 0; i < metrics.length; i++)
							{
								let name = metrics[i].name;
								if(name.startsWith (themeMetric))
									values.push (name);
							}
						}
					}

					completionItemKind = CompletionItemKind.Variable;
				}
				else if(tagName == "define" && !context.attributeValue.trim ().startsWith ("@"))
				{
					values = ["@property:", "@select:", "@eval:"];
					completionItemKind = CompletionItemKind.Function;
				}
				else if(context.attributeName == "value")
				{
					let resolvedValues: string[] = [];
					if(tagName == "if")
					{
						let property = context.tag.attribs["property"];
						if(property != null)
						{
							if(!property.startsWith ("@") && !property.startsWith ("$"))
								property = "$" + property;

							resolvedValues = SkinDefinitionParser.resolveVariable (context.url, context.tag, property);
						}
					}
					else if(tagName == "case")
					{
						let parent = <Element | null>context.tag.parent;
						if(parent != null && parent.name == "switch")
						{
							let property = parent.attribs["property"];
							if(property != null)
							{
								if(!property.startsWith ("@") && !property.startsWith ("$"))
									property = "$" + property;

								resolvedValues = SkinDefinitionParser.resolveVariable (context.url, context.tag, property);
							}
						}
					}

					for(let i = 0; i < resolvedValues.length; i++)
					{
						let value = resolvedValues[i];
						if(value.indexOf ("@eval:") > -1 || value.indexOf ("@select:") > -1)
							value = this.evaluateExpression (value).result;

						if(value.indexOf ("@property") == -1 && value.indexOf ("$") == -1 && values.indexOf (value) == -1)
							values.push (value);
					}
				}
				else if(context.tag.name == "Options" && context.attributeName == "type")
				{
					let result = ClassModelManager.findEnumDefinitions (context.attributeValue);
					for(let i = 0; i < result.length; i++)
						values.push (result[i]);
				}

				for(let i = 0; i < values.length; i++)
					this.addValueCompletion (context, values[i], completionItemKind, attributeType);
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getEnumCompletionInformation (context: CompletionInfoContext)
	{
		let attributes: {[id: string]: string | undefined} = {};
		if(context.attributes != null)
		{
			for(let i = 0; i < context.attributes.length; i++)
				attributes[context.attributes[i].name] = context.attributes[i].value;
		}

		let tagName = this.resolveElementName (context.tag).name;
		let attributeValues = context.fullAttributeValue.split (/(\s+)/);
		let enumEntries = ClassModelManager.findValidEnumEntries (tagName, context.attributeName, attributes);
		for(let i = 0; i < enumEntries.length; i++)
		{
			if(attributeValues.indexOf (enumEntries[i]) != -1)
				continue;

			this.addValueCompletion (context, enumEntries[i], CompletionItemKind.Value, AttributeType.kEnum);
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getColorCompletionInformation (context: CompletionInfoContext)
	{
		if(!context.attributeValue.startsWith ("@"))
		{
			let defaultColors = ClassModelManager.getDefaultColors ();
			for(let i = 0; i < defaultColors.length; i++)
			{
				if(defaultColors[i].name.toLowerCase ().startsWith (context.attributeValue.toLowerCase ()))
					this.addValueCompletion (context, defaultColors[i].name, CompletionItemKind.Value, AttributeType.kColor, defaultColors[i]);
			}
		}

		let definitions = SkinDefinitionParser.findDefinitions (context.url, DefinitionType.kColor, context.tag, context.attributeValue);
		for(let i = 0; i < definitions.length; i++)
			this.addValueCompletion (context, definitions[i].definition, definitions[i].type, AttributeType.kColor, definitions[i]);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getStyleOrImageCompletionInformation (context: CompletionInfoContext, type: AttributeType)
	{
		let defType = DefinitionType.kStyle;
		if(type == AttributeType.kImage)
			defType = DefinitionType.kImage;

		let definitions = SkinDefinitionParser.findDefinitions (context.url, defType, context.tag, context.attributeValue);
		if(context.attributeValue.indexOf ("$") != -1)
			definitions = definitions.concat (SkinDefinitionParser.findDefinitions (context.url, DefinitionType.kVariable, context.tag, context.attributeValue));

		for(let i = 0; i < definitions.length; i++)
			this.addValueCompletion (context, definitions[i].definition, definitions[i].type, type, definitions[i]);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getUriCompletionInformation (context: CompletionInfoContext)
	{
		if(context.tag.name == "Import")
		{
			let skinPacks = SkinDefinitionParser.getSkinPacks ();
			for(let i = 0; i < skinPacks.length; i++)
			{
				let value = skinPacks[i];
				if(!context.attributeValue.startsWith ("@"))
					value = "@" + value;

				this.addValueCompletion (context, value, CompletionItemKind.Value, AttributeType.kUri);
			}
		}

		let relativePath = context.attributeValue;
		if(relativePath.lastIndexOf ("/") > -1)
			relativePath = relativePath.substring (0, relativePath.lastIndexOf ("/"));

		let path = SkinDefinitionParser.resolveUri (relativePath, context.url);
		if(!fs.existsSync (path) || !fs.statSync (path).isDirectory ())
			return;

		let files = fs.readdirSync (path);
		for(let i = 0; i < files.length; i++)
		{
			if(files[i].startsWith ("."))
				continue; // skip system files (.ds_store)

			let kind: CompletionItemKind = CompletionItemKind.Value;
			if(fs.statSync (path + "/" + files[i]).isDirectory ())
				kind = CompletionItemKind.Folder;

			this.addValueCompletion (context, files[i], kind, AttributeType.kUri);
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getBoolCompletionInformation (context: CompletionInfoContext)
	{
		let entries = ["true", "false"];
		for(let i = 0; i < entries.length; i++)
			this.addValueCompletion (context, entries[i], CompletionItemKind.Value, AttributeType.kBool);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getCompletionInformationForType (context: CompletionInfoContext, type: DefinitionType, forceQualified = false)
	{
		let definitions = SkinDefinitionParser.findDefinitions (context.url, type, context.tag, context.attributeValue, forceQualified);
		for(let i = 0; i < definitions.length; i++)
		{
			let attributeType = SkinDefinitionParser.mapDefinitionTypeToAttributeType (type);
			this.addValueCompletion (context, definitions[i].definition, definitions[i].type, attributeType, definitions[i]);
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getTagNameCompletionInformation (context: CompletionInfoContext)
	{
		let tagName = this.resolveElementName (context.tag).name;
		if(tagName.length == 0 || tagName == "?")
		{
			let document = DocumentManager.getCurrentDocument (context.url);
			if(context.tag.attribs == null || document == null)
				return;

			let unclosedTags = DocumentManager.findUnclosedTags (context.url);
			let cclSkinData = context.tag.attribs[DocumentManager.kSkinDataAttributeName];
			let targetIndex = DocumentManager.getIndexFromPosition (document.text, context.position);
			for(let i = 0; i < unclosedTags.unclosedTags.length; i++)
			{
				let unclosedTag = unclosedTags.unclosedTags[i];
				let label = unclosedTag.name;
				if(unclosedTag.index + unclosedTag.name.length < targetIndex
					&& (i == unclosedTags.unclosedTags.length - 1 || unclosedTags.unclosedTags[i + 1].index >= targetIndex))
				{
					let prefix = "";
					let postfix = "";
					let dataLength = 0;
					if(label.startsWith ("?"))
					{
						postfix = "?";
						if(tagName.startsWith ("?"))
							label = label.substring (1);
					}
					else
					{
						prefix = "/";
						if(tagName.length == 0 && cclSkinData != null)
						{
							dataLength = cclSkinData.length;
							if(cclSkinData.startsWith (prefix))
							{
								prefix = "";
								dataLength = 0;
							}
						}
					}

					let closingIndex = document.text.indexOf (">", targetIndex);
					if(closingIndex == -1 || closingIndex > document.text.indexOf ("<", targetIndex))
						postfix += ">";

					context.completionItems.push ({
						label: (prefix + label + postfix).substring (dataLength),
						kind: CompletionItemKind.Snippet,
						preselect: true,
						data: { type: TokenType.kTagName, tagName: unclosedTag.name }
					});

					break;
				}
			}
		}

		let parent = context.tag.parent;
		let parentName = "";
		if(parent != null)
			parentName = (<Element>parent).name;

		if(tagName.startsWith ("?"))
		{
			let names = ["platform", "xstring", "language", "defined", "config", "desktop_platform"];
			if(!tagName.startsWith ("?not"))
				names.push ("not");

			for(let i = 0; i < names.length; i++)
			{
				context.completionItems.push ({
					label: names[i],
					kind: CompletionItemKind.Class,
					sortText: "zzz" + names[i], // move to the bottom
					data: { type: TokenType.kTagName, tagName: names[i] }
				});
			}
		}
		else
		{
			let names = ClassModelManager.findSkinElementDefinitions (tagName);
			for(let i = 0; i < names.length; i++)
			{
				if(ClassModelManager.isSkinElementValidInScope (parentName, names[i]))
				{
					if(names[i].toLowerCase () == "externals" && !SkinDefinitionParser.isSkinRoot (context.url))
						continue;

					context.completionItems.push ({
						label: names[i],
						kind: CompletionItemKind.Class,
						data: { type: TokenType.kTagName, tagName: names[i] }
					});
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getCompletionResolveItem (item: CompletionItem): CompletionItem
	{
		if(item.data != null && item.data.type != null)
		{
			let docs = this.getDocumentation (item.data.type, item.data.tagName, item.data.name, item.data.value);
			if(docs != null)
			{
				item.detail = he.decode (docs.brief);
				item.documentation = {
					kind: 'markdown',
					value: docs.detailed
				};
			}
		}

		return item;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findDefinitions (documentUri: string, position: Position, forceUpdate = false, resolveVariables = true): Location[]
	{
		let addUriLocation = (result: Location[], uri: string) =>
		{
			let resolvedUri = SkinDefinitionParser.resolveUri (uri, documentUri);
			if(fs.existsSync (resolvedUri))
			{
				if(resolvedUri.indexOf (":") > -1) // if there is a drive letter, we also need the file protocol
					resolvedUri = "file:///" + resolvedUri;

				result.push ({
					uri: resolvedUri,
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
				});
			}
		};

		let token = DocumentManager.findTokenAtPosition (documentUri, position);
		if(token != null && token.type == TokenType.kAttributeValue && "attributes" in token && token.attributes != null)
		{
			let attribute = token.attributes[token.attributeIndex];
			let attributeValues = [attribute.value];
			if(attributeValues[0].indexOf ("$") > -1 && resolveVariables)
			{
				attributeValues = SkinDefinitionParser.resolveVariable (documentUri, token.tag, attributeValues[0]);
				if(attributeValues.length == 0)
					attributeValues.push (attribute.value);
			}

			let result: Location[] = [];
			for(let i = 0; i < attributeValues.length; i++)
			{
				let type = ClassModelManager.findAttributeType (token.tag.name, attribute.name).type;
				if(type == AttributeType.kColor)
				{
					let def = SkinDefinitionParser.lookupDefinition (documentUri, DefinitionType.kColor, token.tag, attributeValues[i], LookupDefinitionOptions.kForceExact);
					result = result.concat (def);
				}
				else if(type == AttributeType.kUri)
					addUriLocation (result, attributeValues[i]);
				else
				{
					let defType = SkinDefinitionParser.mapAttributeTypeToDefinitionType (type);
					if((defType == null || !resolveVariables) && attribute.value.indexOf ("$") > -1)
					{
						let startIndex = token.valueBeforeCursor.lastIndexOf ("$");
						if(startIndex > -1)
						{
							defType = DefinitionType.kVariable;
							attributeValues = [SkinDefinitionParser.extractVariableName (documentUri, token.tag, attribute.value.substring (startIndex))];
						}
					}

					if(type == AttributeType.kStyleArray)
					{
						let startIndex = attributeValues[i].lastIndexOf (" ", token.valueBeforeCursor.length - 1);
						let endIndex = attributeValues[i].indexOf (" ", token.valueBeforeCursor.length);
						attributeValues = [attributeValues[i].substring (startIndex + 1, endIndex > -1 ? endIndex : undefined)];
						defType = DefinitionType.kStyle;
					}

					if(defType == null && attribute.name == "form.name")
						defType = DefinitionType.kForm;

					if(defType == null && attribute.name == "name")
					{
						if(token.tag.name == "Color" || token.tag.name == "ColorScheme.Color")
							defType = DefinitionType.kColor;
						else if(token.tag.name == "Font")
							defType = DefinitionType.kFont;
						else if(token.tag.name == "Form")
							defType = DefinitionType.kForm;
						else if(token.tag.name == "Image" || token.tag.name == "ImagePart" || token.tag.name == "ShapeImage" || token.tag.name == "IconSet")
							defType = DefinitionType.kImage;
						else if(token.tag.name == "Shape")
							defType = DefinitionType.kShape;
						else if(token.tag.name == "Style")
							defType = DefinitionType.kStyle;
					}

					if(defType != null)
					{
						let options = LookupDefinitionOptions.kForceExact;
						if(attribute.name == "form.name")
							options |= LookupDefinitionOptions.kForceQualified;

						let def = SkinDefinitionParser.lookupDefinition (documentUri, defType, token.tag, attributeValues[i], options);
						if(def.length == 0)
						{
							if(type & AttributeType.kUri)
								addUriLocation (result, attributeValues[i]);
							else
							{
								let startIndex = token.valueBeforeCursor.lastIndexOf ("$");
								if(startIndex > -1)
								{
									defType = DefinitionType.kVariable;
									let value = SkinDefinitionParser.extractVariableName (documentUri, token.tag, attribute.value.substring (startIndex));
									def = SkinDefinitionParser.lookupDefinition (documentUri, defType, token.tag, value, options);
								}
							}
						}

						if(def.length > 0)
							result = result.concat (def);
					}
				}
			}

			return result;
		}
		else if(token != null && token.type == TokenType.kAttributeName && token.tag.name == "define")
		{
			let symbol = this.findSymbolAtPosition (documentUri, position, forceUpdate);
			if(symbol != null)
				return [{ uri: documentUri, range: symbol.range }];
		}

		return [];
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findSymbolAtPosition (documentUri: string, position: Position, forceUpdate = false)
	{
		let token = DocumentManager.findTokenAtPosition (documentUri, position);
		if(token != null && "attributes" in token && token.attributes != null && token.attributeIndex != null)
		{
			if(token.type == TokenType.kAttributeValue)
			{
				let symbolName = token.attributes[token.attributeIndex].value;
				let variableStartIndex = token.valueBeforeCursor.lastIndexOf ("$");
				if(variableStartIndex > -1)
				{
					symbolName = SkinDefinitionParser.extractVariableName (documentUri, token.tag, symbolName.substring (variableStartIndex));
					if(symbolName.startsWith ("$"))
						symbolName = symbolName.substring (1);
				}

				let definitions = IntelliSenseProvider.findDefinitions (documentUri, position, forceUpdate);
				if(definitions.length > 0)
				{
					symbolName = SkinDefinitionParser.removeNamespace (definitions[0].uri, symbolName);
					let document = DocumentManager.getCurrentDocument (documentUri, forceUpdate);
					if(document != null)
					{
						let startIndex = DocumentManager.getIndexFromPosition (document.text, position) - token.valueBeforeCursor.length;
						startIndex = document.text.indexOf (symbolName, startIndex);
						let endIndex = startIndex + symbolName.length;
						return {
							range: {
								start: DocumentManager.getPositionFromIndex (document.text, startIndex),
								end: DocumentManager.getPositionFromIndex (document.text, endIndex)
							},
							symbolName: symbolName
						};
					}
				}
			}
			else if(token.type == TokenType.kAttributeName && token.tag.name == "define" && token.tag.startIndex != null)
			{
				let document = DocumentManager.getCurrentDocument (documentUri, true);
				if(document != null)
				{
					let name = token.attributes[token.attributeIndex].name;
					let tagText = DocumentManager.findTagText (token.tag, documentUri, forceUpdate);
					let startIndex = token.tag.startIndex + 1 + token.tag.name.length + tagText.indexOf (name); // +1 for <
					return {
						range: {
							start: DocumentManager.getPositionFromIndex (document.text, startIndex),
							end: DocumentManager.getPositionFromIndex (document.text, startIndex + name.length)
						},
						symbolName: name
					};
				}
			}
		}

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static async findReferences (documentUri: string, position: Position, skinsLocations: string[]): Promise<Location[]>
	{
		let result: Location[] = [];
		let symbol = this.findSymbolAtPosition (documentUri, position, true);
		if(symbol != null)
		{
			let searchValue = symbol.symbolName;
			let definitions = this.findDefinitions (documentUri, position, false, false);
			for(let i = 0; i < definitions.length; i++)
			{
				let definitionText = DocumentManager.getTextFromRange (definitions[i].uri, definitions[i].range);
				if(definitionText != null && definitionText.indexOf (searchValue) > -1)
					result.push ({ uri: definitions[i].uri, range: { start: definitions[i].range.start, end: definitions[i].range.end } });
			}

			let isExternalDefinition = false;
			for(let i = 0; i < result.length; i++)
			{
				let definitionText = DocumentManager.getTextFromRange (result[i].uri, result[i].range);
				if(definitionText == null)
					continue;

				let searchValueIndex = definitionText.indexOf (searchValue);
				if(searchValueIndex > -1)
				{
					let document = DocumentManager.getCurrentDocument (result[i].uri, true);
					if(document == null)
						continue;

					let startIndex = DocumentManager.getIndexFromPosition (document.text, result[i].range.start) + searchValueIndex;
					let endIndex = startIndex + searchValue.length;
					result[i].uri = FilesystemHelper.removeProtocol (result[i].uri);
					result[i].range.start = DocumentManager.getPositionFromIndex (document.text, startIndex);
					result[i].range.end = DocumentManager.getPositionFromIndex (document.text, endIndex);

					let found = false;
					let token = DocumentManager.findTokenAtTagLocation (result[i]);
					if(token && token.attributes)
					{
						if(token.tag.name == "External")
							isExternalDefinition = true;

						let attribute = token.attributes.find (attribute => attribute.value == searchValue);
						if(attribute)
							found = true;
					}

					if(!found)
					{
						delete result[i];
						i--;
					}
				}
			}

			let root = FilesystemHelper.findRootDirectory (documentUri);
			if(root != null)
			{
				await FilesystemHelper.traverseDirectory (root, (filePath, document) =>
				{
					if(document.indexOf (searchValue) > -1)
					{
						let textDocument = TextDocument.create ("file://" + filePath, "xml", 1, document);
						if(isExternalDefinition)
							SkinDefinitionParser.buildDefinitionDirectory (textDocument, skinsLocations);

						this.verifySearchResults (result, filePath, document, searchValue, definitions, isExternalDefinition);
					}
				});
			}
		}

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static verifySearchResults (result: Location[], filePath: string, document: string, searchValue: string, definitions: Location[], isExternalDefinition: boolean)
	{
		let searchIndex = 0;
		while(searchIndex > -1)
		{
			searchIndex = document.indexOf (searchValue, searchIndex + 1);
			if(searchIndex > -1)
			{
				let valueLength = searchValue.length;
				if(searchValue.startsWith ("$"))
				{
					searchIndex++; // search after variable prefix
					valueLength--;
				}

				let pos = DocumentManager.getPositionFromIndex (document, searchIndex);
				let defs = this.findDefinitions (filePath, pos, true, false);
				for(let d = 0; d < definitions.length; d++)
				{
					for(let i = 0; i < defs.length; i++)
					{
						let isCompatibleDefinition = false;
						if(isExternalDefinition)
							isCompatibleDefinition = FilesystemHelper.getDocumentText (definitions[i].uri, false) != null;
						else
						{
							isCompatibleDefinition = FilesystemHelper.removeProtocol (definitions[d].uri) == FilesystemHelper.removeProtocol (defs[i].uri)
														&& SkinDefinitionParser.equalRange (definitions[d].range, defs[i].range);
						}

						if(isCompatibleDefinition)
						{
							let range = {
								start: pos,
								end: {
									line: pos.line,
									character: pos.character + valueLength
								}
							};

							let found = false;
							for(let r = 0; r < result.length; r++)
							{
								if(result[r].uri == filePath && SkinDefinitionParser.equalRange (result[r].range, range))
								{
									found = true;
									break;
								}
							}

							if(!found)
								result.push ({ uri: filePath, range: range });
						}
					}
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getColorInformation (uri: string): ColorInformation[]
	{
		let colors = this.colorValues[uri];
		if(colors == null)
			return [];

		return colors;
	}
}
