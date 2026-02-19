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
// Filename    : server/src/documentmanager.ts
// Description : Document Manager
//
//************************************************************************************************

import { Location, Position, Range } from 'vscode-languageserver';
import * as htmlparser2 from 'htmlparser2';
import { ElementType } from 'htmlparser2';
import { Document, Element, ProcessingInstruction, ChildNode, Comment } from 'domhandler';
import { FilesystemHelper } from './filesystemhelper';

//************************************************************************************************
// Definitions
//************************************************************************************************

export enum TokenType
{
	kTagName,
	kAttributeName,
	kAttributeValue,
	kInvalidType
}

export type TagAttributes = { [id: string]: TagAttribute | undefined };
export type TagAttribute = { index: number, value: string, valueIndex: number, reDefinition: boolean };

type TagLocation = {
	name: string,
	originalName: string,
	index: number
};

type UnclosedTags = {
	unclosedTags: TagLocation[],
	danglingClosingTags: TagLocation[]
};

//************************************************************************************************
// DocumentManager
//************************************************************************************************

export class DocumentManager
{
	private static currentDocument: { uri: string, text: string, content: Document } | null = null;

	public static readonly kSkinDataAttributeName = "CCLSKINDATA";

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getCurrentDocument (uri: string, forceUpdate = false): { uri: string, text: string, content: Document } | null
	{
		if(forceUpdate || this.currentDocument == null || this.currentDocument.uri != uri)
		{
			let text = FilesystemHelper.getDocumentText (uri, true);
			if(text == null)
				return null;

			let dom = htmlparser2.parseDocument (text, { withStartIndices: true, withEndIndices: true, xmlMode: true });
			if(dom.startIndex == null)
				dom.startIndex = 0;

			this.currentDocument = {
				uri: uri,
				text: text,
				content: dom
			};
		}

		return this.currentDocument;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static findTagAtPosition (node: Document | Element | ProcessingInstruction, index: number): Element | null
	{
		if(node.startIndex == null)
			return null;

		if(node.startIndex >= index)
			return null;

		let children: ChildNode[] = [];
		if("children" in node && node.children != null)
			children = node.children;

		for(let i = 0; i < children.length; i++)
		{
			if(children[i].type != ElementType.Tag && children[i].type != ElementType.Directive)
				continue;

			let child = <Element>children[i];
			let startI1 = children[i].startIndex;
			if(i == children.length - 1)
			{
				if(startI1 != null && startI1 < index)
				{
					let token = this.findTagAtPosition (child, index);
					if(token != null)
						return token;

					return child;
				}
				else
					break;
			}

			let startI2 = children[i + 1].startIndex;
			if(startI1 != null && startI1 < index && startI2 != null && startI2 >= index)
			{
				let token = this.findTagAtPosition (child, index);
				if(token != null)
					return token;
				
				return child;
			}
		}

		if(children.length == 0 && (node instanceof Element || node instanceof ProcessingInstruction))
		{
			if(node instanceof ProcessingInstruction)
			{
				let result = new Element (node.name, {}, [], ElementType.Tag);
				result.startIndex = node.startIndex;
				result.endIndex = node.endIndex;
				result.next = node.next;
				result.nextSibling = node.nextSibling;
				result.parent = node.parent;
				result.parentNode = node.parentNode;
				result.prev = node.prev;
				result.previousSibling = node.previousSibling;

				return result;
			}

			return node;
		}
		else if(children.length == 1 && (children[0].type == ElementType.Tag || children[0].type == ElementType.Directive))
			return this.findTagAtPosition (children[0], index);

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getIndexFromPosition (document: string, position: Position)
	{
		let lines = document.split (/\n/g);
		let index = position.character;
		if(position.line >= lines.length)
			return -1;

		for(let i = 0; i < position.line; i++)
			index += lines[i].length + 1; // + 1 for the newline

		return index;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getPositionFromIndex (document: string, index: number): Position
	{
		return this.getRangeFromIndices (document, index, index).start;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getRangeFromIndices (document: string, startIndex: number, endIndex: number): Range
	{
		let foundStartPos = false;
		let startPos = { line: 0, character: 0 };
		let pos = 0;
		let line = 0;
		while(true)
		{
			let nextPos = document.indexOf ("\n", pos);
			if(nextPos >= startIndex && !foundStartPos)
			{
				startPos.line = line;
				startPos.character = startIndex - pos;
				foundStartPos = true;
			}

			if(nextPos == -1 || nextPos >= endIndex)
				break;

			pos = nextPos + 1; // +1 for the newline
			line++;
		}

		return {
			start: startPos,
			end: {
				line: line,
				character: endIndex - pos
			}
		};
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getTextFromRange (documentUri: string, range: Range)
	{
		let document = DocumentManager.getCurrentDocument (documentUri);
		if(document == null)
			return null;

		let startIndex = DocumentManager.getIndexFromPosition (document.text, range.start);
		let endIndex = DocumentManager.getIndexFromPosition (document.text, range.end);
		return document.text.substring (startIndex, endIndex);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findTagContent (tag: Element | ProcessingInstruction, document: string)
	{
		let className = tag.name;
		let startIndex = tag.startIndex;
		if(startIndex == null)
			return "";

		let tagOffset = startIndex + 1 + className.length;
		let end: number | undefined | null = undefined;
		if(tag instanceof Element && tag.children.length > 0)
			end = tag.children[0].startIndex;
		else if(tag.nextSibling != null)
			end = tag.nextSibling.startIndex;

		if(end == null)
			end = undefined;

		let subText = document.substring (tagOffset, end);
		let terminatorIndex = subText.indexOf ("<"); // if there is no closing bracket, ensure not to include the next tag
		if(terminatorIndex == -1)
			terminatorIndex = subText.length;

		terminatorIndex = Math.min (terminatorIndex, subText.indexOf (">"));

		return subText.substring (0, terminatorIndex);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findTagText (tag: Element | ProcessingInstruction, documentUri: string, forceUpdate = false)
	{
		let document = this.getCurrentDocument (documentUri, forceUpdate);
		if(document == null)
			return "";

		return this.findTagContent (tag, document.text);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findTagAttributes (tag: Element, tagText: string): TagAttributes
	{
		let tagName = tag.name;
		let startIndex = tag.startIndex;
		if(startIndex == null)
			return {};

		let tagOffset = startIndex + 1 + tagName.length;
		let attributes = tagText.matchAll (/([^="\s<>/]+)(?:\s*=\s*"([^"]*)"?)?|([^='\s<>/]+)(?:\s*=\s*'([^']*)'?)?/g);

		let result: { [id: string]: { index: number, value: string, valueIndex: number, reDefinition: boolean } } = {};
		for(let attribute of attributes)
		{
			if(attribute.length < 2 || attribute.index == null)
				continue;

			let name = attribute[1];
			if(name == null)
				continue;

			if(name.match (/[A-Za-z0-9_\:\.]+/) == null)
				continue; // invalid attribute name

			let value = "";
			if(attribute[2] != null)
				value = attribute[2];
			else
				tag.attribs[name] = "";

			if(value.startsWith ("/>"))
				value = "";

			let nameIndex = attribute.index;
			let subText = tagText.substring (nameIndex + name.length);
			if(nameIndex > -1)
				nameIndex += tagOffset;

			let quotIndex = subText.indexOf ("\"");
			if(quotIndex == -1)
				quotIndex = subText.indexOf ("'");

			if(tag.attribs[name] != null)
			{
				result[name] = {
					index: nameIndex,
					value: value,
					valueIndex: nameIndex + name.length + quotIndex + 1,
					reDefinition: result[name] != null
				};
			}
		}

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findTokenAtTagLocation (location: Location)
	{
		return this.findTokenAtPosition (location.uri, {
			line: location.range.start.line,
			character: location.range.start.character + 1 // +1 for skipping the opening <
		});
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findTokenAtPosition (documentUri: string, position: Position)
	{
		let document = this.getCurrentDocument (documentUri);
		if(document == null)
			return null;

		const index = this.getIndexFromPosition (document.text, position);

		let tagElement = this.findTagAtPosition (document.content, index);
		if(tagElement == null)
			return null;

		let className = tagElement.name;
		let startIndex = tagElement.startIndex;
		if(startIndex == null)
			return null;

		let tagOffset = startIndex + 1 + className.length;
		if(startIndex + 1 <= index && tagOffset >= index)
		{
			if(tagElement.name.endsWith ("<"))
				tagElement.name = tagElement.name.substring (0, tagElement.name.length - 1);

			return { type: TokenType.kTagName, tag: tagElement };
		}
		else if(tagOffset < index)
		{
			let tagText = this.findTagText (tagElement, document.uri);
			let attributes = this.findTagAttributes (tagElement, tagText);
			let resultType: TokenType = TokenType.kInvalidType;
			let attributeKeyValues: { name: string, value: string }[] = [];
			let attributeIndex = -1;
			let valueBeforeCursor = "";

			let i = 0;
			for(let name in attributes)
			{
				let attr = attributes[name];
				if(attr == null)
					continue;

				attributeKeyValues.push ({ name: name, value: attr.value });
				if(attr.index <= index && attr.index + name.length >= index)
				{
					resultType = TokenType.kAttributeName;
					attributeIndex = i;
					valueBeforeCursor = name.substring (0, index - attr.index);
				}
				else if(attr.valueIndex <= index && attr.valueIndex + attr.value.length >= index)
				{
					resultType = TokenType.kAttributeValue;
					attributeIndex = i;
					valueBeforeCursor = attr.value.substring (0, index - attr.valueIndex);
				}

				i++;
			}

			if(resultType != TokenType.kInvalidType)
				return { type: resultType, tag: tagElement, attributeIndex: attributeIndex, valueBeforeCursor: valueBeforeCursor, attributes: attributeKeyValues }

			if(tagOffset + tagText.length >= index)
				return { type: TokenType.kAttributeName, tag: tagElement, attributeIndex: -1, valueBeforeCursor: "", attributes: attributeKeyValues };
		}

		let tag: Element | Comment | null = null;
		if(tagElement.childNodes.length > 0)
			tag = tagElement.childNodes[0] as Element | Comment;

		if(tag == null)
			tag = tagElement.nextSibling as Element | Comment;

		while(tag != null && tag.endIndex != null && tag.endIndex < index)
			tag = tag.nextSibling as Element | Comment;

		if(tag == null)
			return null;

		if(tag.type == ElementType.Comment) // comments are no elements
			return null;

		let result: { type: TokenType, tag: Element } = { type: TokenType.kTagName, tag: tag };
		if(result.tag.name == null)
		{
			if(result.tag.attribs == null)
				result.tag.attribs = {};

			let startIndex = document.text.substring (0, index).lastIndexOf ("<");
			if(startIndex != null)
			{
				let substring = document.text.substring (startIndex);
				if(startIndex + substring.indexOf (">") >= index)
				{
					let match = substring.match (/^<([^\s<>]*)(?:<|>|\s|$)/);
					if(match != null && match.length > 1)
						result.tag.attribs[this.kSkinDataAttributeName] = match[1];
				}
			}

			result.tag.name = "";
		}

		if(result.tag != null && result.tag.startIndex != null && result.tag.startIndex >= index)
			return null; // we are between elements

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findUnclosedTags (documentUri: string): UnclosedTags
	{
		let result: UnclosedTags = {
			unclosedTags: [],
			danglingClosingTags: []
		};
		let document = this.getCurrentDocument (documentUri);
		if(document == null)
			return result;

		let elementStack: (TagLocation & { tagText: string })[] = [];
		let directiveStack: (TagLocation & { tagText: string })[] = [];
		let pos = 0;

		let removeNotOperator = (tagName: string) =>
		{
			if(tagName.startsWith ("?not:"))
				tagName = "?" + tagName.substring ("?not:".length);

			return tagName;
		};

		let openTags = document.text.split ("<");
		let inComment = false;
		let inAlternateProcessingInstruction = false;
		for(let i = 0; i < openTags.length; i++)
		{
			pos++; // +1 for "<"
			let tagPart = openTags[i];
			if(!inComment)
			{
				let leadingWhitespaces = tagPart.substring (0, tagPart.search (/\S|$/));
				let tagText = tagPart.trim ();
				let tagSubParts = tagText.split (/\s/);
				let isDirective = tagPart.startsWith ("?");
				let directiveHasAttributes = tagSubParts.length > 1 && tagSubParts[1].length > 0 && tagSubParts[1] != "?>";
				let tagName = leadingWhitespaces + tagSubParts[0].split (">")[0];
				let latestUnclosedTagName = "";
				let tagStack = isDirective ? directiveStack : elementStack;
				if(tagStack.length > 0)
					latestUnclosedTagName = removeNotOperator (tagStack[tagStack.length - 1].name);

				if(tagText.length == 0)
					continue;
				else if(tagPart.startsWith ("!--"))
				{
					if(tagPart.indexOf ("-->") == -1)
						inComment = true;
				}
				else if(tagPart.startsWith ("?xml") || tagPart.indexOf ("/>") != -1)
				{
					// skip xml header and self closing tags
				}
				else if(isDirective && latestUnclosedTagName == removeNotOperator (tagName) && directiveHasAttributes)
				{
					// skip subsequent processing instructions before the closing instruction
					if(tagStack[tagStack.length - 1].tagText != tagText)
						inAlternateProcessingInstruction = true;
				}
				else if(tagPart.startsWith ("/") || (isDirective && !directiveHasAttributes))
				{
					if(isDirective && latestUnclosedTagName + "?" == tagName)
						inAlternateProcessingInstruction = false;

					if(inAlternateProcessingInstruction)
					{
						pos += tagPart.length;
						continue;
					}

					let resultAdded = false;
					let tempStack = tagStack.slice ();
					while(tempStack.length > 0 && "/" + latestUnclosedTagName != tagName && latestUnclosedTagName + "?" != tagName)
					{
						if(!resultAdded)
						{
							result.unclosedTags.unshift (tempStack[tempStack.length - 1]);
							resultAdded = true;
						}
						tempStack.pop ();
						if(tempStack.length > 0)
							latestUnclosedTagName = removeNotOperator (tempStack[tempStack.length - 1].name);
					}

					if(resultAdded && tempStack.length == 0)
					{
						// The unclosed tag added above may not in fact be unclosed.
						// The dangling tag caused the difference from the expected name on the stack.
						result.unclosedTags.splice (0, 1);
						result.danglingClosingTags.unshift ({ name: tagName, originalName: tagName, index: pos - 1 });
					}
					else
					{
						if(resultAdded) // if tempStack was modified in the loop above
						{
							tagStack.length = 0;
							tagStack.push (...tempStack);
						}

						tagStack.pop ();
					}
				}
				else if(!inAlternateProcessingInstruction)
					tagStack.push ({ name: removeNotOperator (tagName), originalName: tagName, index: pos - 1, tagText: tagText });
			}
			else if(tagPart.indexOf ("-->") != -1)
				inComment = false;

			pos += tagPart.length;
		}

		let addToResult = (tagStack: TagLocation[]) =>
		{
			for(let unclosedTagIndex = 0; unclosedTagIndex < tagStack.length; unclosedTagIndex++)
				result.unclosedTags.push (tagStack[unclosedTagIndex]);
		};
		addToResult (elementStack);
		addToResult (directiveStack);

		result.unclosedTags.sort ((a, b) => { return a.index - b.index; });
		result.danglingClosingTags.sort ((a, b) => { return a.index - b.index; });

		return result;
	}
}
