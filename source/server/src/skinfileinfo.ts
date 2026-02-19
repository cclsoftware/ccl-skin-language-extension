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
// Filename    : server/src/skinfileinfo.ts
// Description : Skin File Info
//
//************************************************************************************************

import * as htmlparser2 from 'htmlparser2';
import { ElementType } from 'htmlparser2';
import { Document, Element, ProcessingInstruction } from 'domhandler';
import * as fs from 'fs';
import * as os from 'os';

import {
	CompletionItemKind,
	Location,
	Range
} from 'vscode-languageserver';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { DomHelper } from './domhelper';
import { DefineInfo, VariableResolver } from './variableresolver';
import { DocumentManager } from './documentmanager';
import { FilesystemHelper } from './filesystemhelper';
import { DefinitionType, SkinDefinitionParser, escapeRegExp } from './skindefinitionparser';
import { AttributeType, ClassModelManager } from './classmodelmanager';

export type DuplicateDefinition = { name: string, type: DefinitionType, range: Range, otherDefinition: Location };

type ParseContext = { document: Document, text: string };
type PendingDefineResolve = { elem: Element, formName: string, attributes: { [id: string]: string }, attributeName: string, defineStartIndex: number };
type PendingViewInstantiationResolve = { elem: Element, formName: string, mainForm: string };

//************************************************************************************************
// SkinFileInfo
//************************************************************************************************

export class SkinFileInfo
{
	private colorDefinitions: {
		[id: string]: { [id: string]: Range | undefined } | undefined
	} = {};

	private styleDefinitions: {
		[id: string]: Range | undefined
	} = {};

	private appStyleDefinitions: {
		[id: string]: Range | undefined
	} = {};

	private imageDefinitions: {
		[id: string]: Range | undefined
	} = {};

	private shapeDefinitions: {
		[id: string]: Range | undefined
	} = {};

	private fontDefinitions: {
		[id: string]: Range | undefined
	} = {};

	private formDefinitions: {
		[id: string]: Range | undefined
	} = {};

	private sizedDelegateDefinitions: {
		[id: string]: Range | undefined
	} = {};

	private metricDefinitions: {
		[id: string]: Range | undefined
	} = {};

	private formDependencies: {
		[id: string]: { name: string, scope: Element }[] | undefined
	} = {};

	private defines: Map<string, DefineInfo[]> = new Map ();
	private viewInstantiations: Map<string, { parentName: string, instantiations: Element[] }[]> = new Map ();
	private duplicateDefinitions: DuplicateDefinition[] = [];

	private containsPlatformDefinitions = false;
	private containsOptionalDefinitions = false;

	private latestRefresh = 0;
	private latestFileModification = 0;

	private document?: TextDocument;

	private skinFiles: Map<string, SkinFileInfo> = new Map ();

	private static readonly kMinRefreshInterval = 500; //< in milliseconds
	private static readonly kViewParentElements = ["ScrollView", "View", "Target", "Delegate", "PopupBox"];
	static kWellKnownVariables = ["$frame", "$APPNAME", "$APPCOMPANY", "$APPVERSION", "$COPYYEAR", "$CLOUDNAME", "$APPNAMEFREE", "$CCLAUTHOR", "$CCLNAME"];

	// see system.cpp SystemInformation::resolveLocation
	static kWellKnownUrlVariables = ["$SYSTEM", "$PROGRAMS", "$SHAREDDATA", "$SHAREDSETTINGS", "$TEMP", "$DESKTOP", "$USERSETTINGS", "$USERPREFERENCES",
									 "$USERDOCS", "$USERMUSIC", "$DOWNLOADS", "$USERCONTENT", "$SHAREDCONTENT", "$APPSETTINGS", "$APPSETTINGSPLATFORM",
									 "$APPSETTINGSALL", "$APPSUPPORT", "$DEPLOYMENT"];

	//////////////////////////////////////////////////////////////////////////////////////////////////

	constructor (private root: string, private url: string, private namespace: string)
	{}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getNamespace ()
	{
		return this.namespace;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public setNamespace (namespace: string)
	{
		this.namespace = namespace;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getDuplicateDefinitions ()
	{
		return this.duplicateDefinitions;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getIncludedFiles (): Map<string, SkinFileInfo>
	{
		return this.skinFiles;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getSkinPackRoot (): string
	{
		return this.root;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getViewParents (viewName: string)
	{
		if(viewName.startsWith ("/"))
			viewName = viewName.substring (1); // remove leading slash

		if(viewName.startsWith (this.getNamespace () + "/"))
			viewName = viewName.substring (this.getNamespace ().length + 1);

		let parents = this.viewInstantiations.get (viewName);
		if(parents != null)
			return parents;

		return [];
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getDefines (formName: string)
	{
		let define = this.defines.get (formName);
		if(define != null)
			return define;

		return [];
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public refreshDefinitions (document?: TextDocument)
	{
		let currentTime = new Date ().valueOf ();
		if(currentTime - this.latestRefresh < SkinFileInfo.kMinRefreshInterval)
			return;

		this.latestRefresh = currentTime;

		if(document != null)
			this.latestFileModification = currentTime;
		else
		{
			let fullPath = this.root + this.url;
			if(!fs.existsSync (fullPath))
			{
				console.warn ("File not found: " + fullPath);
				return;
			}

			const stats = fs.statSync (fullPath);
			let modTime = stats.mtime.valueOf ();
			if(modTime <= this.latestFileModification)
				return;

			this.latestFileModification = modTime;
		}

		this.colorDefinitions = {};
		this.styleDefinitions = {};
		this.appStyleDefinitions = {};
		this.imageDefinitions = {};
		this.shapeDefinitions = {};
		this.fontDefinitions = {};
		this.formDefinitions = {};
		this.sizedDelegateDefinitions = {};
		this.metricDefinitions = {};
		this.defines = new Map ();
		this.viewInstantiations = new Map ();
		this.duplicateDefinitions = [];
		this.skinFiles = new Map ();
		this.formDependencies = {};

		this.parseSkinFile (document);
		this.latestRefresh = new Date ().valueOf ();
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getDefinitionsForType (type: DefinitionType)
	{
		if(type == DefinitionType.kColor)
			return this.colorDefinitions[""];
		else if(type == DefinitionType.kStyle)
			return this.styleDefinitions;
		else if(type == DefinitionType.kAppStyle)
			return this.appStyleDefinitions;
		else if(type == DefinitionType.kImage)
			return this.imageDefinitions;
		else if(type == DefinitionType.kShape)
			return this.shapeDefinitions;
		else if(type == DefinitionType.kFont)
			return this.fontDefinitions;
		else if(type == DefinitionType.kForm)
			return this.formDefinitions;
		else if(type == DefinitionType.kSizedDelegate)
			return this.sizedDelegateDefinitions;
		else if(type == DefinitionType.kMetric)
			return this.metricDefinitions;

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public lookupDefinition (type: DefinitionType, value: string, forceQualified: boolean): Location | null
	{
		if(type == DefinitionType.kColor)
		{
			let { schemeName, definitionName } = SkinFileInfo.getSchemeAndDefinitionName (value);
			let scheme = this.colorDefinitions[schemeName];
			if(scheme != null)
			{
				let range = scheme[definitionName];
				if(range != null)
					return Location.create (this.getFileUrl (), range);
			}
		}
		else
		{
			let definitions = this.getDefinitionsForType (type);
			if(definitions && Object.keys (definitions).length > 0)
			{
				let defName = this.matchNamespace (value, forceQualified);
				if(defName != null)
				{
					let range = definitions[defName];
					if(range != null)
						return Location.create (this.getFileUrl (), range);
				}
			}
		}

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public findDefinitions (type: DefinitionType, value: string): { definition: string, type: CompletionItemKind }[]
	{
		let result: { definition: string, type: CompletionItemKind }[] = [];
		let addToResult = (item: string) =>
		{
			if(item.length == 0)
				return;

			let type: CompletionItemKind = CompletionItemKind.Value;
			let valueWithoutNamespace = value;
			while(valueWithoutNamespace.length > 0 && item[0] == valueWithoutNamespace[0] && (['$', '/', '@'].indexOf (valueWithoutNamespace[0]) > -1))
			{
				item = item.substring (1);
				valueWithoutNamespace = valueWithoutNamespace.substring (1);
			}

			if(value.indexOf ("/") > -1)
				valueWithoutNamespace = value.substring (value.indexOf ("/") + 1);

			let processDelimiter = (delimiter: string) =>
			{
				if(item.indexOf (delimiter) > -1)
				{
					// if the full definition is xxxx.yyyy.zzzz and value is xxxx.yy, add yyyy to the result to only show the
					// current hierarchy level.
					item = item.substring (valueWithoutNamespace.lastIndexOf (delimiter) + 1);
					if(item.indexOf (delimiter) > -1)
					{
						type = CompletionItemKind.Module;
						item = item.substring (0, item.indexOf (delimiter));
					}
				}
			};

			processDelimiter (".");
			processDelimiter (":");

			if(item.indexOf ("[") > -1)
			{
				if(valueWithoutNamespace.indexOf ("[") == -1)
				{
					item = item.substring (0, item.indexOf ("["));
					type = CompletionItemKind.Field;
				}
				else
					item = item.substring (valueWithoutNamespace.lastIndexOf ("[") + 1);

				if(item.indexOf ("]") > -1)
					item = item.substring (0, item.indexOf ("]"));
			}

			for(let i = 0; i < result.length; i++)
			{
				if(result[i].definition == item && result[i].type == type)
					return;
			}

			result.push ({ definition: item, type: type });
		};

		if(type == DefinitionType.kColor)
		{
			let { schemeName, definitionName } = SkinFileInfo.getSchemeAndDefinitionName (value);
			for(let scheme in this.colorDefinitions)
			{
				if(scheme.toLowerCase ().startsWith (schemeName.toLowerCase ()))
				{
					for(let def in this.colorDefinitions[scheme])
					{
						if(definitionName.length == 0 || def.toLowerCase ().startsWith (definitionName.toLowerCase ()))
						{
							let schemeString = "";
							if(scheme.length > 0)
								schemeString = "@" + scheme + ".";

							addToResult (schemeString + def);
						}
					}
				}
			}
		}
		else
		{
			let definitions = this.getDefinitionsForType (type);
			if(definitions != null && Object.keys (definitions).length > 0)
			{
				if(this.namespace.length > 0 && this.namespace.startsWith (value))
					result.push ({ definition: this.namespace, type: CompletionItemKind.Folder });

				let definitionName = this.matchNamespace (value, true);
				if(definitionName != null)
				{
					value = definitionName;
					for(let def in definitions)
					{
						if(value.length == 0 || def.toLowerCase ().startsWith (value.toLowerCase ()))
							addToResult (def);
					}
				}
			}
		}

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public isDefined (type: DefinitionType, value: string, forceQualified: boolean)
	{
		if(type == DefinitionType.kColor)
		{
			let { schemeName, definitionName } = SkinFileInfo.getSchemeAndDefinitionName (value);
			let scheme = this.colorDefinitions[schemeName];
			if(scheme != null && scheme[definitionName] != null)
				return true;
		}
		else
		{
			let definitions = this.getDefinitionsForType (type);
			if(definitions != null)
			{
				let styleName = this.matchNamespace (value, forceQualified);
				if(styleName != null)
					return definitions[styleName] != null;
			}
		}

		return false;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private matchNamespace (value: string, forceQualified: boolean)
	{
		if(value.startsWith ("/"))
		{
			if(this.namespace.length > 0)
				return null;

			value = value.substring (1);
		}

		let separatorIndex = value.indexOf ("/");
		let namespace = "";
		if(separatorIndex != -1)
		{
			namespace = value.substring (0, separatorIndex);
			value = value.substring (separatorIndex + 1);
		}
		else if(forceQualified)
		{
			if(this.namespace.length == 0)
				return value;

			return null;
		}

		if(namespace.length == 0 || namespace == this.namespace)
			return value;

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getDocumentText ()
	{
		if(this.document != null)
			return this.document.getText ();
		else
		{
			let fullPath = this.root + this.url;
			let text = FilesystemHelper.getDocumentText (fullPath, true);
			if(text == null)
			{
				console.warn ("File not found: " + fullPath);
				return "";
			}

			return text;
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getURI ()
	{
		return this.root + this.url;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private parseSkinFile (textDocument?: TextDocument)
	{
		if(textDocument != null)
			this.document = textDocument;

		let documentText = this.getDocumentText ();

		this.containsPlatformDefinitions = documentText.indexOf ("<?platform") > -1;
		this.containsOptionalDefinitions = documentText.indexOf ("<?language") > -1 || documentText.indexOf ("<?defined") > -1 || documentText.indexOf ("<?not:") > -1;

		let dom = htmlparser2.parseDocument (documentText, { withStartIndices: true, withEndIndices: true, xmlMode: true });
		if(dom.startIndex == null)
			dom.startIndex = 0;

		let context: ParseContext = { document: dom, text: documentText };
		this.parseColorScheme (context);
		this.parseResources (context);
		this.parseDelegates (context);
		this.parseElement (context, "Styles", ["Style", "StyleAlias"], this.styleDefinitions, DefinitionType.kStyle);
		this.parseElement (context, "Styles", ["Style", "StyleAlias"], this.appStyleDefinitions, DefinitionType.kAppStyle, (elem) => { return elem.attribs["appstyle"] == "true"; });
		this.parseElement (context, "ThemeElements", "Font", this.fontDefinitions, DefinitionType.kFont);
		this.parseElement (context, "ThemeElements", "Metric", this.metricDefinitions, DefinitionType.kMetric);
		let colorDefs = this.colorDefinitions[""];
		if(colorDefs == null)
			colorDefs = {};

		this.parseElement (context, "ThemeElements", "Color", colorDefs, DefinitionType.kColor);
		this.colorDefinitions[""] = colorDefs;

		this.parseElement (context, "Skin", "Form", this.formDefinitions, DefinitionType.kForm);
		let pendingViewInstantiationResolves: PendingViewInstantiationResolve[] = [];
		for(let i in this.formDefinitions)
		{
			this.addViewInstantiations (dom, i, pendingViewInstantiationResolves);
			this.addFormDependencies (dom, i);
		}

		this.parseImages (context);
		this.parseShapes (context);
		this.parseDefines (context, pendingViewInstantiationResolves);

		// includes of the skin root are parsed by the SkinDefinitionParser itself
		if(!this.url.endsWith (SkinDefinitionParser.kSkinXMLFileName))
			this.parseIncludes (context);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private getFileUrl ()
	{
		let infix = "";
		let fullPath = this.root + this.url;
		if(!fullPath.startsWith ("/"))
			infix = "/";

		return "file://" + infix + fullPath;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private addDuplicateDefinition (name: string, type: DefinitionType, range: Range, otherRange: Range)
	{
		for(let i = 0; i < this.duplicateDefinitions.length; i++)
		{
			let def = this.duplicateDefinitions[i];
			if(def.name == name && def.type == type && SkinDefinitionParser.equalRange (def.range, range))
				return;
		}

		this.duplicateDefinitions.push ({
			name: name,
			type: type,
			range: range,
			otherDefinition: Location.create (this.getURI (), otherRange)
		});
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private parseColorScheme (context: ParseContext)
	{
		let colorschemes = DomHelper.findChildren (context.document, "ColorScheme");
		for(let c = 0; c < colorschemes.length; c++)
		{
			let colorschemeName = colorschemes[c].attribs["name"];
			if(colorschemeName != null && colorschemeName.length > 0)
			{
				let colorscheme = colorschemes[c].childNodes;
				if(colorscheme != null)
				{
					for(let index = 0; index < colorscheme.length; index++)
					{
						if(colorscheme[index].type == ElementType.Tag)
						{
							let color = <Element>colorscheme[index];
							if(color.tagName == "ColorScheme.Color")
							{
								let range = this.getRangeFromElement (color, context);
								if(range != null)
								{
									let def = this.colorDefinitions[colorschemeName];
									if(def == null)
										def = {};

									let colorName = color.attribs["name"];
									let otherRange = def[colorName];
									if(otherRange != null)
									{
										if(!this.isOptionallyDefined (color))
											this.addDuplicateDefinition (colorName, DefinitionType.kColor, range, otherRange);
									}

									def[colorName] = range;
									this.colorDefinitions[colorschemeName] = def;
								}
							}
						}
					}
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private parseResources (context: ParseContext)
	{
		let resources = DomHelper.findChildren (context.document, "Resources");
		for(let r = 0; r < resources.length; r++)
		{
			let children = resources[r].childNodes;
			if(children != null)
			{
				for(let i = 0; i < children.length; i++)
				{
					if(children[i].type != ElementType.Tag)
						continue;

					let child = <Element>children[i];
					if(child.tagName == "Color")
					{
						let range = this.getRangeFromElement (child, context);
						if(range != null)
						{
							if(this.colorDefinitions[""] == null)
								this.colorDefinitions[""] = {};

							if(child.attribs["name"] != null)
							{
								let colorName = "$" + child.attribs["name"];
								let otherRange = this.colorDefinitions[""][colorName];
								if(otherRange != null)
								{
									if(!this.isOptionallyDefined (child))
										this.addDuplicateDefinition (colorName, DefinitionType.kColor, range, otherRange);
								}
								this.colorDefinitions[""][colorName] = range;
							}
						}
					}
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private parseDelegates (context: ParseContext)
	{
		let delegates = DomHelper.findChildren (context.document, "Delegate");
		for(let d = 0; d < delegates.length; d++)
		{
			if(delegates[d].type != ElementType.Tag)
				continue;

			let delegate = <Element>delegates[d];
			let attribs = delegate.attribs;
			if(attribs["width"] == null && attribs["height"] == null && attribs["size"] == null)
				continue; // only consider sized delegates

			let range = this.getRangeFromElement (delegate, context);
			let formName = delegate.attribs["form.name"];
			if(range != null && formName != null)
				this.sizedDelegateDefinitions[formName] = range;
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private parseElement (context: ParseContext, parentName: string, name: string | string[], definitions: { [id: string]: Range | undefined }, type: DefinitionType, filter?: (element: Element) => boolean)
	{
		let parent = DomHelper.findFirstChild (context.document, parentName);
		if(parent == null)
			return;

		let elements = DomHelper.findChildren (parent, name);
		for(let i = 0; i < elements.length; i++)
		{
			if(elements[i].type != ElementType.Tag)
				continue;

			let element = <Element>elements[i];
			if(filter != null && !filter (element))
				continue;

			let range = this.getRangeFromElement (element, context);
			if(range != null)
			{
				let elementName = element.attribs["name"];
				if(elementName != null)
				{
					let otherRange = definitions[elementName];
					if(otherRange != null)
					{
						if(!this.isOptionallyDefined (element))
							this.addDuplicateDefinition (elementName, type, range, otherRange);
					}
					definitions[elementName] = range;
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private parseShapes (context: ParseContext)
	{
		let shapesElement = DomHelper.findFirstChild (context.document, "Shapes");
		if(shapesElement == null)
			return;

		for(let i = 0; i < shapesElement.children.length; i++)
		{
			if(shapesElement.children[i].type != ElementType.Tag)
				continue;

			let shape = <Element>shapesElement.children[i];
			let range = this.getRangeFromElement (shape, context);
			if(range != null)
			{
				let shapeName = shape.attribs["name"];
				if(shapeName == null)
					continue;

				let otherRange = this.shapeDefinitions[shapeName];
				if(otherRange != null)
				{
					if(!this.isOptionallyDefined (shape))
						this.addDuplicateDefinition (shapeName, DefinitionType.kShape, range, otherRange);
				}

				this.shapeDefinitions[shapeName] = range;

				let children = DomHelper.findDirectChildren (shape, "Shape");
				for(let c = 0; c < children.length; c++)
				{
					let child = children[c];
					let childName = child.attribs["name"];
					if(childName == null)
						continue;

					let childRange = this.getRangeFromElement (child, context);
					if(childRange != null)
						this.shapeDefinitions[shapeName + "[" + childName + "]"] = childRange;
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private parseImages (context: ParseContext)
	{
		let resourcesElement = DomHelper.findFirstChild (context.document, "Resources");
		if(resourcesElement == null)
			return;

		let images = DomHelper.findDirectChildren (resourcesElement, ["Image", "ImagePart", "ShapeImage", "IconSet"]);
		for(let i = 0; i < images.length; i++)
		{
			let image = images[i];
			let range = this.getRangeFromElement (image, context);
			if(range != null)
			{
				let imageName = image.attribs["name"];
				if(imageName == null)
					continue;

				let otherRange = this.imageDefinitions[imageName];
				if(otherRange != null)
				{
					if(!this.isOptionallyDefined (image))
						this.addDuplicateDefinition (imageName, DefinitionType.kImage, range, otherRange);
				}

				this.imageDefinitions[imageName] = range;

				let children = DomHelper.findChildren (image, ["Image", "ImagePart", "ShapeImage"]);
				for(let c = 0; c < children.length; c++)
				{
					let child = children[c];
					let childName = child.attribs["name"];
					if(childName == null)
						continue;

					let childRange = this.getRangeFromElement (child, context);
					if(childRange != null)
						this.imageDefinitions[imageName + "[" + childName + "]"] = childRange;
				}

				let framesAttr = image.attribs["frames"];
				if(framesAttr != null && framesAttr.length > 0)
				{
					if(framesAttr.indexOf (":") > -1)
						framesAttr = framesAttr.substring (framesAttr.indexOf (":") + 1);

					let frames = framesAttr.split (" ");
					for(let f = 0; f < frames.length; f++)
					{
						let frameName = frames[f];
						if(frameName.length > 0 && this.imageDefinitions[imageName + "[" + frameName + "]"] == null)
							this.imageDefinitions[imageName + "[" + frameName + "]"] = range;
					}
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private parseIncludes (context: ParseContext)
	{
		let includes = DomHelper.findChildren (context.document, "Include");
		for(let i = 0; i < includes.length; i++)
		{
			let url: string | undefined = includes[i].attribs["url"];
			if(url != null)
			{
				let fullPath = this.root + url;
				let skinFile = this.skinFiles.get (fullPath);
				if(skinFile == null)
				{
					if(!fs.existsSync (fullPath))
						return;

					skinFile = new SkinFileInfo (this.root, url, this.namespace);
					skinFile.refreshDefinitions ();
					this.skinFiles.set (fullPath, skinFile);
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private parseDefines (context: ParseContext, pendingViewInstantiationResolves: PendingViewInstantiationResolve[])
	{
		let pendingDefineResolves: PendingDefineResolve[] = [];
		let defines = DomHelper.findChildren (context.document, ["define", "foreach", "styleselector"]);
		for(let d = 0; d < defines.length; d++)
		{
			let defineStartIndex = defines[d].startIndex;
			if(defineStartIndex == null)
				continue;

			let attributes: { [name: string]: string } = {};
			if(defines[d].tagName == "define")
				attributes = defines[d].attribs;
			else if(defines[d].tagName == "foreach")
			{
				let result = VariableResolver.extractForeach (defines[d], false);
				if(result != null && result.values.length > 0)
					attributes[result.variable] = result.values[0];
			}
			else if(defines[d].tagName == "styleselector")
			{
				let name = defines[d].attribs["variable"];
				let valueString = defines[d].attribs["styles"];
				if(name != null && name.startsWith ("$") && valueString != null)
				{
					name = name.substring (1); // remove $
					let values = valueString.trim ().split (" ");
					attributes[name] = "@foreach([" + values.join (",") + "])";
				}
			}

			SkinDefinitionParser.putExpressionInParentheses (attributes);
			let children = DomHelper.findChildren (defines[d], SkinFileInfo.kViewParentElements);
			for(let c = 0; c < children.length; c++)
			{
				let child = children[c];
				let name: string | null = null;
				if(child.tagName == "Delegate" || child.tagName == "PopupBox")
					name = child.attribs["form.name"];
				else
					name = child.attribs["name"];
				
				if(name != null)
				{
					for(let a in attributes)
						this.addDefine (context, child, name, attributes, a, defineStartIndex, pendingDefineResolves, pendingViewInstantiationResolves);
				}
			}
		}

		while(pendingDefineResolves.length > 0 || pendingViewInstantiationResolves.length > 0)
		{
			let remainingDefineResolves: PendingDefineResolve[] = [];
			let remainingViewInstantiationResolves: PendingViewInstantiationResolve[] = [];
			for(let i = 0; i < pendingDefineResolves.length; i++)
			{
				let pending = pendingDefineResolves[i];
				let resolvedNames = SkinDefinitionParser.resolveVariable (this.root + this.url, pending.elem, pending.formName);
				if(resolvedNames.length == 0)
					remainingDefineResolves.push (pending);
				else
				{
					for(let r = 0; r < resolvedNames.length; r++)
					{
						this.addDefine (context, pending.elem, resolvedNames[r], pending.attributes, pending.attributeName,
										pending.defineStartIndex, [], pendingViewInstantiationResolves);
					}
				}
			}

			for(let i = 0; i < pendingViewInstantiationResolves.length; i++)
			{
				let pending = pendingViewInstantiationResolves[i];
				let resolvedNames = SkinDefinitionParser.resolveVariable (this.root + this.url, pending.elem, pending.formName);
				if(resolvedNames.length == 0)
					remainingViewInstantiationResolves.push (pending);
				else
				{
					for(let r = 0; r < resolvedNames.length; r++)
						this.addViewInstantiation (pending.elem, resolvedNames[r], pending.mainForm, []);
				}
			}

			if(remainingDefineResolves.length == pendingDefineResolves.length &&
				remainingViewInstantiationResolves.length == pendingViewInstantiationResolves.length)
			{
				break;
			}

			pendingDefineResolves = remainingDefineResolves;
			pendingViewInstantiationResolves = remainingViewInstantiationResolves;
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private addDefine (context: ParseContext, elem: Element, formName: string, attributes: { [id: string]: string }, attributeName: string, defineStartIndex: number,
					   pendingDefineResolves: PendingDefineResolve[], pendingViewInstantiationResolves: PendingViewInstantiationResolve[])
	{
		if(formName == null || formName.length == 0 || elem.startIndex == null)
			return;

		if(formName.indexOf ("$") > -1)
		{
			pendingDefineResolves.push ({ elem: elem, formName: formName, attributes: attributes, attributeName: attributeName, defineStartIndex: defineStartIndex });
			return;
		}

		let formDefs = this.defines.get (formName);
		if(formDefs == null)
		{
			formDefs = [];
			this.defines.set (formName, formDefs);
		}

		let def = formDefs.find (info => info.name == attributeName);
		if(def == null)
		{
			def = { name: attributeName, values: [] };
			formDefs.push (def);
		}

		let attributeValue = attributes[attributeName];

		let found = false;
		for(let i = 0; i < def.values.length; i++)
		{
			if(def.values[i].value == attributeValue)
			{
				found = true;
				break;
			}
		}

		if(!found)
		{
			let startIndex = context.text.indexOf (attributeName, defineStartIndex);
			def.values.push ({
				value: attributeValue,
				location: {
					url: this.getURI (),
					start: startIndex,
					end: startIndex + attributeName.length
				}
			});
		}

		this.addViewInstantiations (context.document, formName, pendingViewInstantiationResolves);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private addViewInstantiations (document: Document, formName: string, pendingViewInstantiationResolves: PendingViewInstantiationResolve[])
	{
		if(formName.startsWith (this.getNamespace () + "/"))
			formName = formName.substring (this.getNamespace ().length + 1);

		let form = DomHelper.findFirstChild (document, "Form", "name", formName);
		if(form != null)
		{
			let children = DomHelper.findChildren (form, SkinFileInfo.kViewParentElements);
			for(let c = 0; c < children.length; c++)
			{
				let child = children[c];
				let viewName: string | null = null;
				if(child.tagName == "Delegate" || child.tagName == "PopupBox")
					viewName = child.attribs["form.name"];
				else
					viewName = child.attribs["name"];

				if(viewName != null && viewName.length > 0)
					this.addViewInstantiation (child, viewName, formName, pendingViewInstantiationResolves);
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getFormDependencies (formName: string)
	{
		return this.formDependencies[formName];
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private addFormDependencies (document: Document, formName: string)
	{
		if(formName.startsWith (this.getNamespace () + "/"))
			formName = formName.substring (this.getNamespace ().length + 1);

		let definedVariables: string[] = [];

		let checkElement = (form: Element, elem: Element) =>
		{
			let tagName = elem.tagName.toLowerCase ();
			let isIf = tagName == "if";
			let isSwitch = tagName == "switch";
			let isDefine = tagName == "define";

			for(let name in elem.attribs)
			{
				if(isDefine)
				{
					if(definedVariables.indexOf (name) == -1)
						definedVariables.push (name);
				}

				if((isIf || isSwitch) && (name == "defined" || name == "not.defined"))
					continue;
				if(isSwitch && name == "property")
					continue;

				if(elem.attribs[name].indexOf ("$") > -1)
				{
					let deps = this.formDependencies[formName];
					if(deps == null)
						deps = [];

					let varName = elem.attribs[name].substring (elem.attribs[name].indexOf ("$"));
					for(let i = 0; i < SkinFileInfo.kWellKnownVariables.length; i++)
						varName = varName.replaceAll (SkinFileInfo.kWellKnownVariables[i], "");

					if(ClassModelManager.findAttributeType (elem.tagName, name).type & AttributeType.kUri)
					{
						for(let i = 0; i < SkinFileInfo.kWellKnownUrlVariables.length; i++)
							varName = varName.replace (new RegExp (escapeRegExp (SkinFileInfo.kWellKnownUrlVariables[i]), "ig"), "");
					}

					let isDefined = false;
					for(let def of definedVariables)
					{
						if(varName.substring (1).startsWith (def))
						{
							isDefined = true;
							break;
						}
					}

					if(!isDefined && varName.indexOf ("$") > -1)
					{
						let found = false;
						for(let i = 0; i < deps.length; i++)
						{
							if(varName.startsWith (deps[i].name))
							{
								found = true;
								break;
							}
							else if(deps[i].name.startsWith (varName))
							{
								deps[i].name = varName;
								deps[i].scope = elem;
								found = true;
								break;
							}
						}

						if(!found)
							deps.push ({ name: varName, scope: elem });

						this.formDependencies[formName] = deps;
					}
				}
			}

			if(!isIf && !isSwitch)
			{
				let children = elem.children;
				for(let c = 0; c < children.length; c++)
				{
					if(children[c].type == ElementType.Tag)
						checkElement (form, children[c] as Element);
				}
			}
		};

		let form = DomHelper.findFirstChild (document, "Form", "name", formName);
		if(form != null)
			checkElement (form, form);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private addViewInstantiation (elem: Element, viewName: string, mainForm: string,
								  pendingViewInstantiationResolves: PendingViewInstantiationResolve[])
	{
		if(viewName.indexOf ("$") > -1)
		{
			for(let i = 0; i < pendingViewInstantiationResolves.length; i++)
			{
				if(pendingViewInstantiationResolves[i].elem == elem &&
					pendingViewInstantiationResolves[i].formName == viewName &&
					pendingViewInstantiationResolves[i].mainForm == mainForm)
				{
					return;
				}
			}

			pendingViewInstantiationResolves.push ({ elem: elem, formName: viewName, mainForm: mainForm });
			return;
		}

		if(viewName.startsWith (this.getNamespace () + "/"))
			viewName = viewName.substring (this.getNamespace ().length + 1);

		let parents = this.viewInstantiations.get (viewName);
		if(parents == null)
			parents = [];

		let parent = parents.find (value => value.parentName == mainForm);
		if(parent == null)
		{
			parent = { parentName: mainForm, instantiations: [] };
			parents.push (parent);
		}

		parent.instantiations.push (elem);

		this.viewInstantiations.set (viewName, parents);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public getRangeFromElement (element: Element, context: { text: string })
	{
		if(element.startIndex == null)
			return null;

		if(!this.isDefinedForPlatform (element))
			return null;

		let nodeValue = DocumentManager.findTagContent (element, context.text);
		let nodeTextLength = element.tagName.length + nodeValue.length + 2; // + 2 for the two angular brackets
		return DocumentManager.getRangeFromIndices (context.text, element.startIndex, element.startIndex + nodeTextLength);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private isOptionallyDefined (elem: Element): boolean
	{
		if(!this.containsOptionalDefinitions)
			return false;

		let prev = elem.previousSibling;
		while(prev != null)
		{
			if(prev.type == ElementType.Directive)
			{
				let prevElem = <ProcessingInstruction>prev;
				if(prevElem.name == "?language" || prevElem.name == "?defined" || prevElem.name.startsWith ("?not:"))
					return true;
			}

			prev = prev.previousSibling;
		}

		if(elem.parent != null && elem.parent.type == ElementType.Tag)
			return this.isOptionallyDefined (<Element>elem.parent);

		return false;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private isDefinedForPlatform (elem: Element): boolean
	{
		if(!this.containsPlatformDefinitions)
			return true;

		let platformString = "";
		if(os.platform () == "darwin")
			platformString = "mac";
		else if(os.platform () == "win32")
			platformString = "win";

		let prev = elem.previousSibling;
		while(prev != null)
		{
			if(prev.type == ElementType.Directive)
			{
				let prevElem = <ProcessingInstruction>prev;
				if(prevElem.name == "?platform")
					return prevElem.data == null || prevElem.data.indexOf (" " + platformString) > -1;
				else if(prevElem.name == "?not:platform")
					return prevElem.data == null || prevElem.data.indexOf (" " + platformString) == -1;
				else if(prevElem.name == "?platform?") // platform switch end
					return true;
				else if(prevElem.name == "?desktop_platform")
					return prevElem.data == null || prevElem.data.indexOf (" 1") > -1;
			}

			prev = prev.previousSibling;
		}

		if(elem.parent != null && elem.parent.type == ElementType.Tag)
			return this.isDefinedForPlatform (<Element>elem.parent);

		return true;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getSchemeAndDefinitionName (value: string)
	{
		let schemeName = "";
		let definitionName = value;
		if(value.startsWith ("@"))
		{
			let result = value.match (/@([^\.]+)\.(.*)/);
			if(result != null && result.length == 3)
			{
				schemeName = result[1];
				definitionName = result[2];
			}
			else
			{
				schemeName = value.substring (1);
				if(schemeName.endsWith ("."))
					schemeName = schemeName.substring (0, schemeName.length - 1);

				definitionName = "";
			}
		}
		else if(value.startsWith ("$/"))
			definitionName = "$" + value.substring (2);

		return { schemeName: schemeName, definitionName: definitionName };
	}
}
