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
// Filename    : server/src/skindefinitionparser.ts
// Description : Definition Parser
//
//************************************************************************************************

import * as htmlparser2 from 'htmlparser2';
import { Element } from 'domhandler';
import * as fs from 'fs';

import {
	CompletionItemKind,
	Location,
	Range,
	Position
} from 'vscode-languageserver';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { DomHelper } from './domhelper';
import { VariableResolver } from './variableresolver';
import { FilesystemHelper, kDefaultSkinsLocation } from './filesystemhelper';
import { DuplicateDefinition, SkinFileInfo } from './skinfileinfo';
import { DocumentManager, TokenType } from './documentmanager';
import { AttributeType, ClassModelManager } from './classmodelmanager';

export enum DefinitionType
{
	kColor,
	kStyle,
	kAppStyle, // subset of style
	kImage,
	kShape,
	kFont,
	kMetric,
	kForm,
	kSizedDelegate,
	kVariable
}

export enum LookupDefinitionOptions
{
	kNone = 0,
	kForceQualified = 1 << 0,
	kForceExact = 1 << 1
};

export enum VariableDefinedResult
{
	kFalse,
	kTrue,
	kSomePaths
};

export enum IterateOptions
{
	kNone,
	kIsUnqualifiedForm = 1 << 0,
	kAllowForeignNamespaces = 1 << 1
};

export let escapeRegExp = (string: string) =>
{
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

type SkinPackInfo = { namespace: string, url: string, isImport: boolean };

const kOverrideAttribute = "override";

//************************************************************************************************
// SkinDefinitionParser
//************************************************************************************************

export class SkinDefinitionParser
{
	public static readonly kSkinXMLFileName = "skin.xml";
	private static currentSkinPackRoot: string | null = null;
	private static skinsRoots: string[] = [];
	private static skinFiles: { [url: string]: SkinFileInfo | undefined } = {};
	private static fileIncludes: Map<string, string[]> = new Map;
	private static skinPacks: string[] = [];
	private static externalDefinitions: { def: string, type: DefinitionType, context: Location }[] = [];
	private static externalsPatterns: { [pattern: string]: Location | undefined } = {};

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static buildDefinitionDirectory (document: TextDocument, skinsLocations: string[])
	{
		let fileUrl = FilesystemHelper.removeProtocol (document.uri);
		this.currentSkinPackRoot = this.findSkinPackRoot (fileUrl);
		if(this.currentSkinPackRoot == null)
			return;

		this.findSkinsRoots (this.currentSkinPackRoot, skinsLocations);
		this.externalsPatterns = this.parseExternalsPatterns (this.currentSkinPackRoot);
		let currentSkinFiles = this.skinFiles;
		let loadSkinFiles = (rootUrl: string) =>
		{
			let skinPack = this.findIncludedSkinFiles (rootUrl + SkinDefinitionParser.kSkinXMLFileName);
			skinPack.push ({ namespace: "", url: SkinDefinitionParser.kSkinXMLFileName, isImport: false });

			let result: SkinFileInfo[] = [];
			for(let i = 0; i < skinPack.length; i++)
			{
				let paths = this.findSkinPackUrls (rootUrl, skinPack[i]);
				if(paths == null)
					continue;

				let { root, url } = paths;
				let fullPath = root + url;

				let textDocument: TextDocument | undefined = undefined;
				if(fullPath == fileUrl)
					textDocument = document;

				let skinFile = currentSkinFiles[fullPath];
				let refreshNeeded = false;
				if(skinFile == null)
				{
					skinFile = new SkinFileInfo (root, url, skinPack[i].namespace);
					refreshNeeded = true;
				}

				result.push (skinFile);
				skinFile.setNamespace (skinPack[i].namespace);
				this.skinFiles[fullPath] = skinFile;

				if(textDocument != null || refreshNeeded)
					skinFile.refreshDefinitions (textDocument);

				let includes = this.fileIncludes.get (rootUrl);
				if(includes == null)
					includes = [];

				if(includes.indexOf (fullPath) == -1)
					includes.push (fullPath);

				this.fileIncludes.set (rootUrl, includes);
			}

			currentSkinFiles = this.skinFiles;

			return result;
		};

		let findExternalDefinitions = (fileInfos: SkinFileInfo[]) =>
		{
			// find references to external definitions
			for(let i = 0; i < fileInfos.length; i++)
			{
				let info = fileInfos[i];
				let externalsPatterns = Object.keys (this.parseExternalsPatterns (info.getURI ()));
				if(externalsPatterns.length == 0)
					continue;

				let regex = new RegExp ("=\\s*\"(" + externalsPatterns.join ("|") + ")(?:\")", "g");
				let text = info.getDocumentText ();
				let matches = text.matchAll (regex);
				for(let match of matches)
				{
					if(match.index != null && match.length > 1)
					{
						let startPosition = DocumentManager.getPositionFromIndex (text, match.index + match[0].indexOf (match[1]));
						let token = DocumentManager.findTokenAtPosition (info.getURI (), startPosition);
						if(token != null)
						{
							if(token.type == TokenType.kAttributeValue && "attributes" in token && token.attributeIndex != null)
							{
								let attributeTypes = ClassModelManager.findValidAttributes (token.tag.name);
								let attribute = token.attributes[token.attributeIndex];
								let type = attributeTypes[attribute.name];
								if(type != null)
								{
									let defType = this.mapAttributeTypeToDefinitionType (type);
									if(defType != null && !this.isDefinedStrict (info.getURI (), defType, attribute.value))
									{
										for(let rootIndex = 0; rootIndex < this.skinsRoots.length; rootIndex++)
										{
											if(info.getURI ().startsWith (this.skinsRoots[rootIndex]))
											{
												let endPosition = Position.create (startPosition.line, startPosition.character + attribute.value.length);
												let range = Range.create (startPosition, endPosition);
												this.externalDefinitions.push ({ def: attribute.value, type: defType, context: Location.create (info.getURI (), range) });
												break;
											}
										}
									}
								}
							}
						}
					}
				}
			}
		};

		this.skinFiles = {};
		this.externalDefinitions = [];
		findExternalDefinitions (loadSkinFiles (this.currentSkinPackRoot));
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static mapDefinitionTypeToAttributeType (type: DefinitionType)
	{
		if(type == DefinitionType.kColor)
			return AttributeType.kColor;
		else if(type == DefinitionType.kStyle)
			return AttributeType.kStyle;
		else if(type == DefinitionType.kImage)
			return AttributeType.kImage;
		else if(type == DefinitionType.kShape)
			return AttributeType.kShape;
		else if(type == DefinitionType.kFont)
			return AttributeType.kFont;
		else if(type == DefinitionType.kForm)
			return AttributeType.kForm;
		else if(type == DefinitionType.kMetric)
			return AttributeType.kFloat;

		return AttributeType.kNoType;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static mapAttributeTypeToDefinitionType (type: AttributeType)
	{
		if(type & AttributeType.kColor)
			return DefinitionType.kColor;
		else if((type & AttributeType.kStyle) || (type & AttributeType.kStyleArray))
			return DefinitionType.kStyle;
		else if(type & AttributeType.kImage)
			return DefinitionType.kImage;
		else if(type & AttributeType.kShape)
			return DefinitionType.kShape;
		else if(type & AttributeType.kFont)
			return DefinitionType.kFont;
		else if(type & AttributeType.kForm)
			return DefinitionType.kForm;
		else if(type == AttributeType.kFloat)
			return DefinitionType.kMetric;

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static isPartOfOwnSkinPack (url: string): boolean
	{
		if(this.getSkinFile (url) != null)
			return true;

		url = FilesystemHelper.removeProtocol (url);
		for(let fileUrl in this.skinFiles)
		{
			let file = this.skinFiles[fileUrl];
			if(file && file.getIncludedFiles ().get (url) != null)
				return true;
		}

		return false;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static isSkinRoot (url: string): boolean
	{
		return url.endsWith (this.kSkinXMLFileName);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getExternalDefinitions (): { def: string, type: DefinitionType, context: Location }[]
	{
		return this.externalDefinitions;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static isVariableDefined (url: string, elem: Element, value: string, options: LookupDefinitionOptions = LookupDefinitionOptions.kNone): VariableDefinedResult
	{
		if(value.indexOf ("$") == -1)
			return VariableDefinedResult.kFalse;

		let result = VariableResolver.findMatchingVariableSubstitutions (url, elem, value.substring (value.indexOf ("$") + 1));
		for(let i = 0; i < result.substitutions.length; i++)
		{
			if(!(options & LookupDefinitionOptions.kForceExact) || result.substitutions[i].postfix.length == 0)
			{
				let loc = result.substitutions[i].location;
				let doc = DocumentManager.getCurrentDocument (loc.url);
				if(doc != null)
					return result.variableDefinedForAllPaths ? VariableDefinedResult.kTrue : VariableDefinedResult.kSomePaths;
			}
		}

		return VariableDefinedResult.kFalse;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static lookupDefinition (url: string, type: DefinitionType, elem: Element, value: string,
									options: LookupDefinitionOptions = LookupDefinitionOptions.kNone): Location[]
	{
		let qualifiedValue = value;
		let result: Location[] = [];
		if(type == DefinitionType.kVariable)
		{
			if(value.indexOf ("$") == -1)
				return [];

			let substitutions = VariableResolver.findMatchingVariableSubstitutions (url, elem, value.substring (value.indexOf ("$") + 1)).substitutions;
			for(let i = 0; i < substitutions.length; i++)
			{
				if(!(options & LookupDefinitionOptions.kForceExact) || substitutions[i].postfix.length == 0)
				{
					let loc = substitutions[i].location;
					let doc = DocumentManager.getCurrentDocument (loc.url);
					if(doc != null)
					{
						result.push ({
							uri: loc.url,
							range: DocumentManager.getRangeFromIndices (doc.text, loc.start, loc.end)
						});
					}
				}
			}
		}
		else
		{
			if(this.canBeQualified (type))
				qualifiedValue = this.qualifyName (url, value);
			else if(type == DefinitionType.kColor && elem.name == "ColorScheme.Color" && elem.parent != null)
			{
				let attribs = (<Element>elem.parent).attribs;
				if(attribs != null)
				{
					let name = attribs["name"];
					if(name != null)
						value = "@" + name + "." + value;
				}
			}

			let forceQualified = (options & LookupDefinitionOptions.kForceQualified) != 0;
			let iterateOptions = 0;
			if(!forceQualified && qualifiedValue != value && type == DefinitionType.kForm)
				iterateOptions = IterateOptions.kIsUnqualifiedForm;

			result = this.forEachFileInScope<Location[]> (url, iterateOptions, [], (result, info) =>
			{
				let loc = info.lookupDefinition (type, value, forceQualified);
				if(loc == null && !forceQualified && value != qualifiedValue && this.canBeQualified (type))
					loc = info.lookupDefinition (type, qualifiedValue, forceQualified);

				if(loc != null)
					result.push (loc);

				return false;
			});

			if(result.length > 1)
			{
				for(let loc of result)
				{
					let token = DocumentManager.findTokenAtTagLocation (loc);
					if(token != null && token.tag.attribs[kOverrideAttribute] != null && token.tag.attribs[kOverrideAttribute].toLowerCase () == "true")
						return [loc];
				}
			}
		}

		if(result.length == 0)
		{
			let suffix = "$";
			if(value.indexOf ("$") > -1)
				suffix = ""; // variables have no end marker, so we match every value that starts with the pattern

			for(let pattern in this.externalsPatterns)
			{
				let regex = new RegExp ("^" + pattern + suffix, "g");
				if(value.match (regex) || qualifiedValue.match (regex))
				{
					let loc = this.externalsPatterns[pattern];
					if(loc != null)
						result.push (loc);
				}
			}
		}

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findDefinitions (url: string, type: DefinitionType, elem: Element, value: string, forceQualified = false)
		: { definition: string, type: CompletionItemKind }[]
	{
		if(type == DefinitionType.kVariable)
		{
			let result: { definition: string, type: CompletionItemKind }[] = [];
			let vars = VariableResolver.getVariablesInScope (url, elem, value);
			let skipOwnAttributes = false;
			for(let i = 0; i < vars.length; i++)
			{
				if(vars[i].startsWith ("<"))
					skipOwnAttributes = true; // this can happen in incomplete code where the next tag is recognized as attribute of the current tag

				if(!skipOwnAttributes || elem.attribs[vars[i]] == null)
					result.push ({ definition: vars[i], type: CompletionItemKind.Variable });
			}
			
			return result;
		}
		else
		{
			let qualifiedValue = value;
			if(this.canBeQualified (type))
				qualifiedValue = this.qualifyName (url, value);

			let ownNamespace = "";
			if(!forceQualified)
				ownNamespace = this.getNamespace (url);

			let options = IterateOptions.kAllowForeignNamespaces;
			if(!forceQualified && qualifiedValue != value && type == DefinitionType.kForm)
				options |= IterateOptions.kIsUnqualifiedForm;

			return this.forEachFileInScope<{ definition: string, type: CompletionItemKind }[]> (url, options, [], (result, info) =>
			{
				let definitions = [];
				if(!forceQualified && this.canBeQualified (type))
					definitions = info.findDefinitions (type, qualifiedValue);
				else
					definitions = info.findDefinitions (type, value);

				for(let i = 0; i < definitions.length; i++)
				{
					if(!forceQualified && ownNamespace.length > 0 && definitions[i].definition.startsWith (ownNamespace + "/"))
						definitions[i].definition = definitions[i].definition.substring (ownNamespace.length + 1);

					let isNewDefinition = true;
					for(let r = 0; r < result.length; r++)
					{
						if(result[r].definition == definitions[i].definition && result[r].type == definitions[i].type)
						{
							isNewDefinition = false;
							break;
						}
					}

					if(isNewDefinition)
						result.push (definitions[i]);
				}

				return false;
			});
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static isDefined (url: string, type: DefinitionType, value: string, forceQualified = false): boolean
	{
		let suffix = "$";
		if(value.indexOf ("$") > -1)
			suffix = ""; // variables have no end marker, so we match every value that starts with the pattern

		for(let pattern in this.externalsPatterns)
		{
			let regex = new RegExp ("^" + pattern + suffix, "g");
			if(value.match (regex))
				return true;
		}

		return this.isDefinedStrict (url, type, value, forceQualified);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static isDefinedStrict (url: string, type: DefinitionType, value: string, forceQualified = false): boolean
	{
		let qualifiedValue = value;
		if(this.canBeQualified (type))
			qualifiedValue = this.qualifyName (url, value);

		let options = 0;
		if(!forceQualified && qualifiedValue != value && type == DefinitionType.kForm)
			options = IterateOptions.kIsUnqualifiedForm;

		return this.forEachFileInScope<{ isDefined: boolean }> (url, options, { isDefined: false }, (result, info) =>
		{
			if(forceQualified || !this.canBeQualified (type))
				result.isDefined = info.isDefined (type, value, forceQualified);
			else
			{
				result.isDefined = info.isDefined (type, qualifiedValue, false);
				if(type == DefinitionType.kStyle && !result.isDefined && value.indexOf ("/") == -1)
					result.isDefined = info.isDefined (DefinitionType.kAppStyle, value, false);
			}

			return result.isDefined;
		}).isDefined;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getDuplicateDefinitions (url: string)
	{
		let file = this.getSkinFile (url);
		if(file == null)
			return [];

		let result = file.getDuplicateDefinitions ();
		this.forEachFileInScope<DuplicateDefinition[]> (url, 0, result, (result, info) =>
		{
			if(file == null)
				return false;

			if(info.getURI () == file.getURI ())
				return false;

			for(let type in DefinitionType)
			{
				if(isNaN (+type))
					continue;

				if(+type == DefinitionType.kSizedDelegate)
					continue; // sizedDelegates are more like a cache than actual definitions

				let defs = file.getDefinitionsForType (+type);
				for(let d in defs)
				{
					let range = defs[d];
					if(range == null)
						continue;

					if(+type != DefinitionType.kColor && d.indexOf ("/") == -1)
					{
						if(file.getNamespace ().length == 0)
						{
							if(info.getNamespace ().length > 0)
								continue;
						}
						else if(info.getNamespace ().length > 0)
							d = file.getNamespace () + "/" + d;
					}

					let otherDefinition = info.lookupDefinition (+type, d, false);
					if(otherDefinition != null)
					{
						let token = DocumentManager.findTokenAtTagLocation (Location.create (url, range));
						if(token != null && token.tag != null)
						{
							let otherToken = DocumentManager.findTokenAtTagLocation (otherDefinition);
							if(otherToken != null && otherToken.tag != null)
							{
								let overrideAttribute = token.tag.attribs[kOverrideAttribute];
								let otherOverrideAttribute = otherToken.tag.attribs[kOverrideAttribute];
								if(overrideAttribute != null && overrideAttribute.toLowerCase () == "true"
									|| otherOverrideAttribute != null && otherOverrideAttribute.toLowerCase () == "true")
								{
									continue; // allow explicitly overridden definitions
								}
							}
						}

						let equalTypes = (t1: DefinitionType, t2: DefinitionType) =>
						{
							return t1 == t2 || ((t1 == DefinitionType.kStyle || t1 == DefinitionType.kAppStyle) && (t2 == DefinitionType.kStyle || t2 == DefinitionType.kAppStyle));
						};

						// Avoid reporting duplicate errors
						let found = false;
						for(let i = 0; i < result.length; i++)
						{
							let r = result[i];
							if(r.name == d && equalTypes (r.type, +type) && this.equalRange (r.range, range)
								&& r.otherDefinition.uri == otherDefinition.uri && this.equalRange (r.otherDefinition.range, otherDefinition.range))
							{
								found = true;
								break;
							}
						}

						if(!found)
							result.push ({ name: d, type: +type, range: range, otherDefinition: otherDefinition });
					}
				}
			}

			return false;
		});

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getSkinPacks (): readonly string[]
	{
		if(this.skinPacks.length > 0)
			return this.skinPacks;

		this.skinPacks = [];
		for(let rootIndex = 0; rootIndex < this.skinsRoots.length; rootIndex++)
		{
			let files = fs.readdirSync (this.skinsRoots[rootIndex]);
			for(let i = 0; i < files.length; i++)
			{
				if(files[i].startsWith ("."))
					continue; // skip system files (.ds_store)

				if(fs.existsSync (this.skinsRoots[rootIndex] + "/" + files[i] + "/skin.xml"))
					this.skinPacks.push (files[i]);
			}
		}

		return this.skinPacks;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static qualifyName (url: string, value: string): string
	{
		if(value.startsWith ("/"))
			return value; // value is already qualified (explicit empty namespace)

		if(value.indexOf ("/") > -1)
			return value; // already qualified

		let file = this.getSkinFile (url);
		if(file == null)
			return value;

		if(file.getNamespace ().length > 0)
			return file.getNamespace () + "/" + value;

		return value;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static removeNamespace (url: string, value: string): string
	{
		if(value.startsWith ("/"))
			value = value.substring (1); // remove leading slash

		if(value.startsWith ("@")) // this is a colorscheme namespace
			return SkinFileInfo.getSchemeAndDefinitionName (value).definitionName;

		let file = this.getSkinFile (url);
		if(file == null)
			return value;

		if(value.startsWith (file.getNamespace () + "/"))
			return value.substring (file.getNamespace ().length + 1);

		return value;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static equalPosition = (p1: Position, p2: Position) =>
	{
		return p1.line == p2.line && p1.character == p2.character;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static equalRange = (r1: Range, r2: Range) =>
	{
		return SkinDefinitionParser.equalPosition (r1.start, r2.start) && SkinDefinitionParser.equalPosition (r1.end, r2.end);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static canBeQualified (type: DefinitionType)
	{
		return type != DefinitionType.kColor && type != DefinitionType.kFont;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static resolveVariable (url: string, element: Element, variable: string): string[]
	{
		return VariableResolver.resolveVariable (url, element, variable);
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static extractVariableName (url: string, element: Element, attributeValue: string): string
	{
		let needs$ = false;
		if(attributeValue.startsWith ("$"))
		{
			attributeValue = attributeValue.substring (1);
			needs$ = true;
		}

		let variables = VariableResolver.getVariablesInScope (url, element, "$");
		let bestCandidate = "";
		for(let v = 0; v < variables.length; v++)
		{
			if(attributeValue.startsWith (variables[v]) && variables[v].length > bestCandidate.length)
				bestCandidate = variables[v];
		}
		if(bestCandidate.length == 0)
		{
			let val = "$" + attributeValue;
			for(let pattern in this.externalsPatterns)
			{
				let regex = new RegExp ("^" + pattern, "g");
				let matches = val.match (regex);
				if(matches != null)
				{
					attributeValue = matches[0];
					if(attributeValue.startsWith ("$"))
						attributeValue = attributeValue.substring (1);

					break;
				}
			}

			if(bestCandidate.length == 0)
				bestCandidate = attributeValue;
		}

		if(needs$)
			bestCandidate = "$" + bestCandidate;

		return bestCandidate;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getSkinFile (url: string)
	{
		url = FilesystemHelper.removeProtocol (url);
		return this.skinFiles[url];
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getNamespace (url: string)
	{
		let namespace = "";
		let file = SkinDefinitionParser.getSkinFile (url);
		if(file != null)
			namespace = file.getNamespace ();

		return namespace;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getUnresolvedVariablesForForm (url: string, formName: string)
	{
		let file = this.getSkinFile (url);
		if(file == null)
			return [];

		let result: { name: string, scope: Location }[] = [];
		this.forEachFileInScope<{ name: string, scope: Location }[]> (url, 0, result, (result, info) =>
		{
			if(file == null)
				return false;

			let deps = info.getFormDependencies (formName);
			if(deps != null)
			{
				for(let i = 0; i < deps.length; i++)
				{
					let dependency = deps[i];
					let variableDefined = this.isVariableDefined (info.getURI (), dependency.scope, dependency.name);
					if(variableDefined != VariableDefinedResult.kTrue && !result.find (item => item.name == dependency.name))
					{
						let range = info.getRangeFromElement (dependency.scope, { text: info.getDocumentText () });
						if(range != null)
							result.push ({ name: dependency.name, scope: { uri: info.getURI (), range: range }});
					}
				}
			}

			return false;
		});

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static forEachFileInScope<T> (url: string, options: IterateOptions, defaultResult: T, resultFunction: (result: T, info: SkinFileInfo) => boolean): T
	{
		url = FilesystemHelper.removeProtocol (url);
		let skinFile = this.getSkinFile (url);
		let namespace = "";
		let result = defaultResult;

		let processFile = (file: SkinFileInfo) =>
		{
			file.refreshDefinitions ();
			if(resultFunction (result, file))
				return true;

			let includedFiles = file.getIncludedFiles ();
			for(const [_, includedFile] of includedFiles)
			{
				if(processFile (includedFile))
					return true;
			}

			return false;
		};

		if(skinFile)
		{
			if(options & IterateOptions.kIsUnqualifiedForm)
				namespace = skinFile.getNamespace ();

			if(processFile (skinFile))
				return result;
		}

		for(const [skinRoot, includedFiles] of this.fileIncludes)
		{
			if(!url.startsWith (skinRoot) && this.currentSkinPackRoot != null && (!this.isSkinRoot (this.currentSkinPackRoot) || this.externalDefinitions.length > 0))
				continue; // not part of current scope

			for(let i = 0; i < includedFiles.length; i++)
			{
				if(FilesystemHelper.removeProtocol (includedFiles[i]) == url)
					continue;

				let skinFileInfo = this.getSkinFile (includedFiles[i]);
				if(skinFileInfo == null || (!(options & IterateOptions.kAllowForeignNamespaces) && namespace.length > 0 && skinFileInfo.getNamespace () != namespace))
					continue;

				if(processFile (skinFileInfo))
					return result;
			}
		}

		return defaultResult;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static findSkinsRoots (currentRoot: string, skinsLocations: string[])
	{
		let root = FilesystemHelper.findRootDirectory (currentRoot, kDefaultSkinsLocation);
		if(root != null)
		{
			this.skinsRoots = [];
			for(let i = 0; i < skinsLocations.length; i++)
			{
				let location = root + skinsLocations[i];
				if(!location.endsWith ("/"))
					location += "/";

				this.skinsRoots.push (location);
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static findSkinPackUrls (currentRoot: string, info: SkinPackInfo): { root: string, url: string } | null
	{
		let result = { root: currentRoot, url: info.url };
		if(info.isImport)
		{
			let slashIndex = info.url.indexOf ("/") + 1;
			let urlStart = info.url.substring (0, slashIndex);
			result.url = info.url.substring (slashIndex);
			for(let i = 0; i < this.skinsRoots.length; i++)
			{
				result.root = this.skinsRoots[i] + urlStart;
				if(fs.existsSync (result.root + result.url))
					return result;
			}
		}
		else if(fs.existsSync (result.root + result.url))
			return result;

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static resolveUri (uri: string, fileUrl: string)
	{
		let baseUrl: string | null = null;
		if(uri.startsWith ("@"))
		{
			uri = uri.substring (1) + "/" + this.kSkinXMLFileName;
			for(let i = 0; i < this.skinsRoots.length; i++)
			{
				baseUrl = this.skinsRoots[i];
				if(fs.existsSync (baseUrl + uri))
					break;
			}
		}
		else
			baseUrl = this.findSkinPackRoot (fileUrl);

		if(baseUrl == null)
			return "";

		while(uri.startsWith ("../"))
		{
			baseUrl = baseUrl.substring (0, baseUrl.lastIndexOf ("/", baseUrl.length - 2) + 1);
			uri = uri.substring (3);
		}

		return baseUrl + uri;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static putExpressionInParentheses (attributes: { [id: string]: string })
	{
		const kKeywords = ["@eval:", "@select:"];
		for(let i in kKeywords)
		{
			let keyword = kKeywords[i];
			for(let a in attributes)
			{
				let evalIndex = attributes[a].indexOf (keyword);
				if(evalIndex > -1)
				{
					evalIndex += keyword.length;
					while(attributes[a].length > evalIndex + 1 && (attributes[a][evalIndex] != "(" || !attributes[a].endsWith (")")))
					{
						attributes[a] = attributes[a].substring (0, evalIndex) + "(" + attributes[a].substring (evalIndex) + ")";
						evalIndex = attributes[a].indexOf (keyword) + keyword.length;
					}
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static isNumeric (str: string)
	{
		return !isNaN (+str) &&           // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
			   !isNaN (parseFloat (str)); // ...and ensure strings of whitespace fail
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findSkinPackRoot (url: string)
	{
		let preparePath = (path: string) =>
		{
			if(!fs.existsSync (path))
			{
				console.warn ("Path not found: " + path);
				return "";
			}

			if(path.endsWith (".xml"))
				path = path.substring (0, path.lastIndexOf ("/"));

			if(!path.endsWith ("/"))
				path += "/";

			return path;
		};

		let rootFound = false;
		let path = FilesystemHelper.removeProtocol (url);
		if(this.currentSkinPackRoot != null && path.startsWith (this.currentSkinPackRoot))
			return this.currentSkinPackRoot;

		let root = preparePath (path);
		while(root.indexOf ("/") != -1)
		{
			if(!root.endsWith ("/"))
				root += "/";

			if(fs.existsSync (root + SkinDefinitionParser.kSkinXMLFileName))
			{
				rootFound = true;
				break;
			}

			let lastIndex = root.lastIndexOf ("/", root.length - 2);
			if(lastIndex == -1)
			{
				root = "";
				break;
			}
			root = root.substring (0, lastIndex);
		}

		if(!root.endsWith ("/"))
			root += "/";

		if(rootFound)
			return root;

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getDocumentText (url: string)
	{
		let buffer = "";
		let fileInfo = this.getSkinFile (url);
		if(fileInfo != null)
			buffer = fileInfo.getDocumentText ();
		else
		{
			let text = FilesystemHelper.getDocumentText (url, true);
			if(text == null)
			{
				console.warn ("File not found: " + url);
				return "";
			}

			buffer = text;
		}

		return buffer;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static findIncludedSkinFiles (url: string): SkinPackInfo[]
	{
		let document = htmlparser2.parseDocument (this.getDocumentText (url), { withStartIndices: true, withEndIndices: true, xmlMode: true });
		let result: SkinPackInfo[] = [];
		let includes = DomHelper.findChildren (document, "Include");
		for(let i = 0; i < includes.length; i++)
		{
			let elem = includes[i];
			let namespace = "";
			if(elem.attribs["name"] != null)
				namespace = elem.attribs["name"];

			if(elem.attribs["url"] != null && elem.attribs["url"].endsWith (".xml"))
				result.push ({ namespace: namespace, url: elem.attribs["url"], isImport: false });
		}

		let addImport = (result: SkinPackInfo[], skinPackName: string) =>
		{
			if(skinPackName.startsWith ("@"))
				skinPackName = skinPackName.substring (1);

			let relativeSkinPackRootFile = skinPackName + "/" + SkinDefinitionParser.kSkinXMLFileName;
			for(let rootIndex = 0; rootIndex < this.skinsRoots.length; rootIndex++)
			{
				let skinPackRootFile = this.skinsRoots[rootIndex] + relativeSkinPackRootFile;
				if(fs.existsSync (skinPackRootFile))
				{
					for(let i = 0; i < result.length; i++)
					{
						if(result[i].url == relativeSkinPackRootFile)
							return; // already added
					}

					result.push ({ namespace: "", isImport: true, url: relativeSkinPackRootFile });
					let skinResult = this.findIncludedSkinFiles (skinPackRootFile);
					if(skinResult != null)
					{
						for(let r = 0; r < skinResult.length; r++)
						{
							skinResult[r].isImport = true;
							skinResult[r].url = skinPackName + "/" + skinResult[r].url;
							result.push (skinResult[r]);
						}
					}

					break;
				}
			}
		};

		let imports = DomHelper.findChildren (document, "Import");
		for(let i = 0; i < imports.length; i++)
		{
			let skinPackName = imports[i].attribs["url"];
			if(skinPackName != null)
				addImport (result, skinPackName);
		}

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static parseExternalsPatterns (url: string)
	{
		let root = this.findSkinPackRoot (url) + this.kSkinXMLFileName;
		let patterns: { [pattern: string]: Location | undefined } = {};
		if(root == null)
			return patterns;

		let documentText = this.getDocumentText (root);
		let document = htmlparser2.parseDocument (documentText, { withStartIndices: true, withEndIndices: true, xmlMode: true });
		let externals = DomHelper.findChildren (document, "External");
		for(let i = 0; i < externals.length; i++)
		{
			let name = externals[i].attribs["name"];
			if(name != null)
			{
				let pattern = name.replace (/[.+?^${}()|[\]\\]/g, '\\$&').replace (/\*+/g, ".*");
				let startIndex = externals[i].startIndex;
				let endIndex = externals[i].endIndex;
				if(startIndex != null && endIndex != null)
				{
					let range = DocumentManager.getRangeFromIndices (documentText, startIndex, endIndex);
					patterns[pattern] = Location.create (root, range);
				}
			}
		}

		return patterns;
	}
}
