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
// Filename    : server/src/classmodelmanager.ts
// Description : Classmodel Manager
//
//************************************************************************************************

import * as htmlparser2 from 'htmlparser2';
import { ElementType } from 'htmlparser2';
import { Document, Element } from 'domhandler';
import * as fs from 'fs';
import { DomHelper } from './domhelper';

//////////////////////////////////////////////////////////////////////////////////////////////////

export type AttributeTypes = { [id: string]: AttributeType | undefined };
type ClassDef = {
	name: string,
	allowedAttributes: AttributeTypes,
	parent: string | null,
	isAbstract: boolean,
	schemaGroups?: string[],
	childrenGroup?: string
};

export type StyleDocumentation = { name: string, type: string, description?: { brief: string, detailed: string } };

//************************************************************************************************
// AttributeType
//************************************************************************************************

export enum AttributeType
{
	kNoType     = 0,
	kBool       = 1 << 0,
	kInt        = 1 << 1,
	kFloat      = 1 << 2,
	kString     = 1 << 3,
	kEnum       = 1 << 4,
	kColor      = 1 << 5,
	kSize       = 1 << 6,
	kRect       = 1 << 7,
	kImage      = 1 << 8,
	kPoint      = 1 << 9,
	kPoint3D    = 1 << 10,
	kUri        = 1 << 11,
	kStyle      = 1 << 12,
	kStyleArray = 1 << 13,
	kShape      = 1 << 14,
	kFont       = 1 << 15,
	kForm       = 1 << 16,
	kFontSize   = 1 << 17,
	kDuration   = 1 << 18,
	kStrNone    = 1 << 19,
	kStrForever = 1 << 20
};

let attributeNames: { [Property in AttributeType]: string } = {
	[AttributeType.kNoType]: "",
	[AttributeType.kBool]: "bool",
	[AttributeType.kInt]: "int",
	[AttributeType.kFloat]: "float",
	[AttributeType.kString]: "string",
	[AttributeType.kEnum]: "enum",
	[AttributeType.kColor]: "color",
	[AttributeType.kSize]: "size",
	[AttributeType.kRect]: "rect",
	[AttributeType.kImage]: "image",
	[AttributeType.kPoint]: "point",
	[AttributeType.kPoint3D]: "point3d",
	[AttributeType.kUri]: "uri",
	[AttributeType.kStyle]: "style",
	[AttributeType.kStyleArray]: "style[]",
	[AttributeType.kShape]: "shape",
	[AttributeType.kFont]: "font",
	[AttributeType.kForm]: "form",
	[AttributeType.kFontSize]: "fontsize",
	[AttributeType.kDuration]: "duration",
	[AttributeType.kStrNone]: '"none"',
	[AttributeType.kStrForever]: '"forever"'
};

//************************************************************************************************
// ClassModelManager
//************************************************************************************************

export class ClassModelManager
{
	private static readonly kSchemaGroupID = "Class:SchemaGroups";
	private static readonly kChildGroupsID = "Class:ChildGroup";

	private static classModelPath: string | null = null;
	private static classModelTimestamp = 0;
	private static classModel: Document | null = null;
	private static styleModelPath: string | null = null;
	private static styleModelTimestamp = 0;
	private static styleModel: Document | null = null;
	private static skinElementCache: { [id:string]: ClassDef | undefined } = {};
	private static enumCache: { [id:string]: { entries: string[], parent?: string } | undefined } = {};
	private static defaultColors: { name: string, hexValue: string }[] = [];
	private static themeMetrics: { name: string, value: number }[] = [];
	private static languages: string[] = [];
	private static isSchemaLoaded = false;

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getDefaultColors (): readonly { name: string, hexValue: string }[]
	{
		return this.defaultColors;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getThemeMetrics (): readonly { name: string, value: number }[]
	{
		return this.themeMetrics;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static reset ()
	{
		this.classModel = null;
		this.skinElementCache = {};
		this.enumCache = {};
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static loadClassModel (path: string)
	{
		if(this.classModelPath == path)
		{
			let isUpToDate = true;
			if(fs.existsSync (path))
			{
				let modifiedTime = fs.statSync (path).mtime.valueOf ();
				if(modifiedTime > this.classModelTimestamp)
				{
					this.classModelTimestamp = modifiedTime;
					isUpToDate = false;
					this.reset ();
				}
			}
			else
				console.error ("Could not find " + path);

			if(isUpToDate)
				return;
		}

		this.classModelPath = path;
		if(fs.existsSync (path))
		{
			let buffer = fs.readFileSync (path, "utf8");
			this.classModel = htmlparser2.parseDocument (buffer.toString (), { withStartIndices: true, withEndIndices: true, xmlMode: true });
		}
		else
			console.error ("Could not find " + path);

		if(this.classModel != null)
		{
			this.cacheClasses (this.skinElementCache, this.classModel);
			this.cacheEnums ();
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findParent (child: string)
	{
		let elem = this.skinElementCache[child.toUpperCase ()];
		if(elem == null)
			return null;

		return elem.parent;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static isClassModelLoaded ()
	{
		return this.classModel != null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static loadStyleModel (path: string)
	{
		if(this.styleModelPath == path)
		{
			let isUpToDate = true;
			if(fs.existsSync (path))
			{
				let modifiedTime = fs.statSync (path).mtime.valueOf ();
				if(modifiedTime > this.styleModelTimestamp)
				{
					this.styleModelTimestamp = modifiedTime;
					isUpToDate = false;
				}
			}

			if(isUpToDate)
				return;
		}

		this.styleModelPath = path;
		if(fs.existsSync (path))
		{
			let buffer = fs.readFileSync (path, "utf8");
			this.styleModel = htmlparser2.parseDocument (buffer.toString (), { withStartIndices: true, withEndIndices: true, xmlMode: true });
		}

		if(this.styleModel != null)
		{
			let defaultColorElem = DomHelper.findFirstChild (this.styleModel, "Model.Enumeration", "name", "DefaultColors");
			if(defaultColorElem)
			{
				let defaultColors = DomHelper.findChildren (defaultColorElem, "Model.Enumerator");
				this.defaultColors = [];
				for(let c = 0; c < defaultColors.length; c++)
					this.defaultColors.push ({ name: defaultColors[c].attribs["name"], hexValue: defaultColors[c].attribs["value"] });
			}

			let themeMetricsElem = DomHelper.findFirstChild (this.styleModel, "Model.Enumeration", "name", "ThemeMetrics");
			if(themeMetricsElem)
			{
				let themeMetrics = DomHelper.findChildren (themeMetricsElem, "Model.Enumerator");
				this.themeMetrics = [];
				for(let c = 0; c < themeMetrics.length; c++)
					this.themeMetrics.push ({ name: themeMetrics[c].attribs["name"], value: +themeMetrics[c].attribs["value"] });
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static loadLanguages (path: string)
	{
		if(fs.existsSync (path))
		{
			this.languages = [];
			let files = fs.readdirSync (path);
			for(let i = 0; i < files.length; i++)
			{
				if(files[i].endsWith (".xml") && !files[i].startsWith ("xx"))
				{
					let lang = files[i].substring (0, files[i].indexOf (".xml"));
					if(this.languages.indexOf (lang) == -1)
						this.languages.push (lang);
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static cacheClasses (cache: { [id:string]: ClassDef | undefined }, model: Document)
	{
		// Cache class names
		let classes = DomHelper.findChildren (model, "Model.Class");
		for(let c = 0; c < classes.length; c++)
		{
			let classElem = classes[c];
			let className = classElem.attribs["name"];
			if(className != null && className.indexOf (" ") != -1)
			{
				console.warn ("Invalid class name: '" + className + "'");
				continue;
			}

			let entry = cache[className.toUpperCase ()];
			if(entry == null)
				entry = { name: className, allowedAttributes: {}, parent: null, isAbstract: classElem.attribs["abstract"] == "1" };

			let parent = classElem.attribs["parent"];
			if(parent != null)
				entry.parent = parent;

			let membersElem = DomHelper.findFirstChild (classElem, "List", "x:id", "members");
			if(membersElem != null)
			{
				let members = membersElem.children;
				for(let m = 0; m < members.length; m++)
				{
					if(members[m].type != ElementType.Tag)
						continue;

					let member = members[m] as Element;
					let attributeName = member.attribs["name"];
					if(attributeName != null)
					{
						let attributeType = entry.allowedAttributes[attributeName];
						if(attributeType == null)
							attributeType = AttributeType.kNoType;

						let typeName = this.getTypeName (model, member, className, attributeName);
						if(typeName != null)
							attributeType = this.parseType (typeName);

						entry.allowedAttributes[attributeName] = attributeType;
					}
				}
			}

			let attributesElem = DomHelper.findFirstChild (classElem, "Attributes", "x:id", "attributes");
			if(attributesElem != null)
			{
				let attributes = attributesElem.children;
				for(let a  = 0; a < attributes.length; a++)
				{
					if(attributes[a].type != ElementType.Tag)
						continue;

					let attribute = attributes[a] as Element;
					let id = attribute.attribs["id"];
					let value = attribute.attribs["value"];
					if(id == this.kSchemaGroupID)
					{
						if(value.length == 0)
							entry.schemaGroups = [];
						else
							entry.schemaGroups = value.split (" ");

						this.isSchemaLoaded = true;
					}
					else if(id == this.kChildGroupsID)
					{
						entry.childrenGroup = value;
						this.isSchemaLoaded = true;
					}
				}
			}

			cache[className.toUpperCase ()] = entry;
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static getTypeName (model: Document, elem: Element, className: string, memberName: string)
	{
		let guessedType = false;
		let typeName = elem.attribs["typeName"];
		if(typeName == null && DomHelper.findFirstChild (model, "Model.Enumeration", "name", className + "." + memberName) != null)
		{
			typeName = "enum";
			guessedType = true;
		}

		if(typeName == null)
		{
			typeName = elem.attribs["type"];
			guessedType = true;
		}

		if(typeName == null)
		{
			typeName = "string";
			guessedType = true;
		}

		if(guessedType)
			console.warn ("No typeName defined for '" + className + "." + memberName + "'. Assuming type '" + typeName + "'.");

		return typeName;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static cacheEnums ()
	{
		let result: string[] = [];
		if(this.classModel == null)
			return result;

		let enumerations = DomHelper.findChildren (this.classModel, "Model.Enumeration");
		for(let i = 0; i < enumerations.length; i++)
		{
			let enumeration = enumerations[i];
			if(enumeration != null)
			{
				let name = enumeration.attribs["name"];
				if(name == null)
					continue;

				let entry: { entries: string[], parent?: string } = { entries: [] };

				let elems = DomHelper.findChildren (enumeration, "Model.Enumerator");
				for(let i = 0; i < elems.length; i++)
				{
					let elementName = elems[i].attribs["name"];
					if(elementName != null && entry.entries.indexOf (elementName) == -1)
						entry.entries.push (elementName);
				}

				entry.parent = enumeration.attribs["parent"];
				this.enumCache[name] = entry;
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static guessType (currentType: AttributeType, className: string, attributeName: string): AttributeType
	{
		attributeName = attributeName.toLowerCase ();

		// Overwrite attribute types with more specific types
		if((className == "Font" && attributeName == "size") || (className == "Style" && attributeName == "textsize"))
			return AttributeType.kFontSize;
		else if(currentType == AttributeType.kFloat && attributeName == "duration")
			return AttributeType.kDuration;
		else if(attributeName == "sizelimits")
			return AttributeType.kRect | AttributeType.kStrNone;
		else if(className == "Animation" && attributeName == "repeat")
			return AttributeType.kInt | AttributeType.kStrForever;

		// There are types missing in the class model (e.g. an image cannot be expressed because there is no type for that)
		// In these cases, the typeName is "string". We allow to overwrite that to get more fine grained types.
		if(currentType == AttributeType.kNoType || currentType == AttributeType.kString)
		{
			// adapted and extended from ccl/gui/skin/coreskinmodel.cpp
			if(attributeName.endsWith ("color") || attributeName.endsWith ("color.disabled") || attributeName.endsWith ("color.on"))
				return AttributeType.kColor;
			else if(attributeName.endsWith ("style") || attributeName == "inherit")
				return AttributeType.kStyleArray;
			else if(attributeName == "image" || attributeName == "icon" || attributeName == "background")
				return AttributeType.kImage;
			else if(attributeName == "url")
			{
				// shape images can have shapes as their url. Shapes are also checked as urls if the attribute name is url
				if(className == "ShapeImage")
					return AttributeType.kShape | AttributeType.kUri;

				return AttributeType.kUri;
			}
			else if(attributeName == "shaperef")
				return AttributeType.kShape;
			else if(className == "Font" && attributeName == "themeid")
				return AttributeType.kFont;
			else if(attributeName == "name" && (className == "View" || className == "Target" || className == "ScrollView") || attributeName == "form.name")
				return AttributeType.kForm;
			else if(className == "Layout" && attributeName == "layout.class")
				return AttributeType.kEnum;
			else if((className == "StyleAlias" || className == "styleselector") && attributeName == "styles")
				return AttributeType.kStyleArray;
		}

		return AttributeType.kNoType;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findSkinElementDefinitions (startOfName: string, ignoreAbstract = true): string[]
	{
		// special case for Layout > layout.class
		if(startOfName == "box")
			return ["Horizontal", "Vertical"];
		else if(startOfName == "clipper")
			return ["Layout"];
		else if(startOfName == "sizevariant")
			return ["SizeVariant"];
		else if(startOfName == "table")
			return ["Table"];

		let result: string[] = [];
		for(let className in this.skinElementCache)
		{
			let element = this.skinElementCache[className];
			if(element == null || (ignoreAbstract && element.isAbstract))
				continue;

			if(className.startsWith (startOfName.toUpperCase ()))
				result.push (element.name);
		}

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findEnumDefinitions (startOfName: string): string[]
	{
		let result: string[] = [];
		for(let name in this.enumCache)
		{
			if(name.startsWith (startOfName))
				result.push (name);
		}

		return result;
	}
	
	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static isSkinElementValidInScope (parentName: string, childName: string)
	{
		if(!this.isSchemaLoaded)
			return true;

		let findChildrenGroup = (className: string): string | null =>
		{
			let elem = this.skinElementCache[className.toUpperCase ()];
			if(elem == null)
				return null;

			if(elem.childrenGroup != null)
				return elem.childrenGroup;

			if(elem.parent != null)
				return findChildrenGroup (elem.parent);

			return null;
		};

		let findSchemaGroups = (className: string): string[] =>
		{
			let elem = this.skinElementCache[className.toUpperCase ()];
			if(elem == null)
				return [];

			let result: string[] = [];
			if(elem.schemaGroups != null)
				result.push (...elem.schemaGroups);

			if(elem.schemaGroups == null && elem.parent != null)
				result.push (...findSchemaGroups (elem.parent));

			result.push (className);
			return result;
		};

		let schemaGroups = findSchemaGroups (childName);
		let childrenGroup = findChildrenGroup (parentName);

		let result = false;
		if(childrenGroup != null)
			result = schemaGroups.indexOf (childrenGroup) > -1;

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findValidAttributes (skinElementName: string)
	{
		return this.findValidAttributesInternal (skinElementName, skinElementName);
	}
	
	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static findValidAttributesInternal (skinElementName: string, originalElementName: string)
	{
		let result: AttributeTypes = {};
		let skinElementDefinition = this.skinElementCache[skinElementName.toUpperCase ()];
		let isStatement = (elemName: string): boolean =>
		{
			let elem = this.skinElementCache[elemName.toUpperCase ()];
			if(elem == null)
				return false;

			if(elem.name == "statement")
				return true;

			if(elem.parent != null)
				return isStatement (elem.parent);

			return false;
		};

		let isControlStatement = isStatement (skinElementName);
		let addResult = (name: string, type: AttributeType | undefined) =>
		{
			if(type == null || isControlStatement && name == "name" && originalElementName.toLowerCase () != "styleselector")
				return; // control statements except styleselector don't have the "name" attribute

			result[name] = type;
		};

		if(skinElementDefinition != null)
		{
			for(let name in skinElementDefinition.allowedAttributes)
				addResult (name, this.findAttributeType (skinElementDefinition.name, name).type);

			if(skinElementDefinition.parent != null)
			{
				let parentAttributes = this.findValidAttributesInternal (skinElementDefinition.parent, originalElementName);
				for(let name in parentAttributes)
					addResult (name, this.findAttributeType (skinElementDefinition.name, name).type);
			}
		}
		else if(skinElementName.startsWith ("?"))
		{
			skinElementName = skinElementName.substring (1);
			if(skinElementName.startsWith ("not:"))
				skinElementName = skinElementName.substring ("not:".length);

			if(skinElementName == "platform")
			{
				addResult ("mac", AttributeType.kString);
				addResult ("win", AttributeType.kString);
				addResult ("ios", AttributeType.kString);
				addResult ("android", AttributeType.kString);
				addResult ("linux", AttributeType.kString);
			}
			else if(skinElementName == "xstring")
				addResult ("off", AttributeType.kString);
			else if(skinElementName == "language")
			{
				addResult ("en", AttributeType.kString);
				for(let i = 0; i < this.languages.length; i++)
					addResult (this.languages[i], AttributeType.kString);
			}
			else if(skinElementName == "config")
			{
				addResult ("debug", AttributeType.kString);
				addResult ("release", AttributeType.kString);
			}
			else if(skinElementName == "desktop_platform")
			{
				addResult ("0", AttributeType.kString);
				addResult ("1", AttributeType.kString);
			}
		}

		// debugging code
		/*for(let a in result)
		{
			let def = result[a];
			if(def != null && !def.isConcreteType && def.type == AttributeType.kString)
			{
				console.warn ("No typeName defined for '" + skinElementName + "." + a +
					"'. Assuming type '" + this.typeToString (def.type) + "'.");
			}
		}*/

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findValidEnumEntries (skinElementName: string, attributeName: string, attributes: {[id: string]: string | undefined}): readonly string[]
	{
		let elem = this.skinElementCache[skinElementName.toUpperCase ()];
		if(elem == null)
			return [];

		skinElementName = elem.name;

		// special case for Layout > layout.class
		if(skinElementName == "Layout" && attributeName == "layout.class")
			return ["box", "clipper", "sizevariant", "table"];
		else if(skinElementName == "Options" && attributeName == "options")
		{
			let type = attributes["type"];
			if(type == null || type.indexOf (".") == -1)
				return [];

			skinElementName = type.substring (0, type.indexOf ("."));
			attributeName = type.substring (type.indexOf (".") + 1);
		}

		let result: string[] = [];
		let addedParents: string[] = [];
		let addEnums = (result: string[], skinElementName: string, attributeName: string, addedParents: string[]) =>
		{
			let totalName = skinElementName + "." + attributeName;
			let entry = this.enumCache[totalName];
			if(entry != null)
			{
				for(let i = 0; i < entry.entries.length; i++)
				{
					if(result.indexOf (entry.entries[i]) == -1)
						result.push (entry.entries[i]);
				}

				if(entry.parent != null && addedParents.indexOf (totalName) == -1)
				{
					addedParents.push (totalName);
					let dotIndex = entry.parent.indexOf (".");
					let parentElementName = entry.parent.substring (0, dotIndex);
					let parentAttributeName = entry.parent.substring (dotIndex + 1);
					addEnums (result, parentElementName, parentAttributeName, addedParents);
				}
			}

			let element = this.skinElementCache[skinElementName.toUpperCase ()];

			if(element != null && element.parent != null)
			{
				let parentElems = this.findValidEnumEntries (element.parent, attributeName, {});
				for(let elemIndex = 0; elemIndex < parentElems.length; elemIndex++)
				{
					if(result.indexOf (parentElems[elemIndex]) == -1)
						result.push (parentElems[elemIndex]);
				}
			}
		};

		addEnums (result, skinElementName, attributeName, addedParents);

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findAttributeType (skinElementName: string, attributeName: string): { type: AttributeType, elementName: string }
	{
		let result = this.findAttributeTypeInternal (skinElementName, attributeName);
		let guessedType = this.guessType (result.type, skinElementName, attributeName);
		if(guessedType != AttributeType.kNoType)
			result.type = guessedType;

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static findAttributeTypeInternal (skinElementName: string, attributeName: string): { type: AttributeType, elementName: string }
	{
		let element = this.skinElementCache[skinElementName.toUpperCase ()];
		if(element == null)
			return { type: AttributeType.kNoType, elementName: skinElementName };

		let type = element.allowedAttributes[attributeName];
		if(type != null && type != AttributeType.kNoType)
			return { type: type, elementName: skinElementName };

		if(element.parent != null)
		{
			let result = this.findAttributeTypeInternal (element.parent, attributeName);
			if(result.type != AttributeType.kNoType)
				return result;
		}

		return { type: AttributeType.kNoType, elementName: skinElementName };
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findSkinElementDocumentation (skinElementName: string):
	{
		inheritance: string[],
		brief: string,
		detailed: string,
		code: string,
		styles: {
			brief: string,
			detailed: string,
			values: StyleDocumentation[]
		}
	} | null
	{
		if(this.classModel == null)
			return null;

		let elem = DomHelper.findFirstChild (this.classModel, "Model.Class", "name", skinElementName);
		if(elem == null)
			return null;

		let docs = this.findDocumentation (elem);
		if(docs != null)
		{
			let inheritance = [skinElementName];
			let styles = { brief: "", detailed: "", values: [] as StyleDocumentation[] };
			let addStyleDocumentation = (elementName: string, docs: StyleDocumentation[]): { brief: string, detailed: string } | null =>
			{
				let styleDocs = this.findStylesDocumentation (docs, elementName + "Style");
				let cachedElem = this.skinElementCache[elementName.toUpperCase ()];
				if(cachedElem != null && cachedElem.parent != null)
				{
					inheritance.push (cachedElem.parent);
					let parentDocs = addStyleDocumentation (cachedElem.parent, docs);
					if(parentDocs != null && (styleDocs == null || styleDocs.brief.length == 0))
						styleDocs = parentDocs;
				}

				return styleDocs;
			};

			let styleDocs = addStyleDocumentation (skinElementName, styles.values);
			if(styleDocs != null)
			{
				styles.brief = styleDocs.brief;
				styles.detailed = styleDocs.detailed;
			}

			styles.values.sort ((s1, s2) => { return s1.name == s2.name ? 0 : (s1.name < s2.name ? -1 : 1); });

			return { inheritance: inheritance, brief: docs.brief, detailed: docs.detailed, code: docs.code, styles: styles };
		}

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static findStylesDocumentation (styles: StyleDocumentation[], styleName: string): { brief: string, detailed: string } | null
	{
		let styleDescription: { brief: string, detailed: string } | null = null;
		if(this.styleModel != null)
		{
			let styleClass = DomHelper.findFirstChild (this.styleModel, "Model.Class", "name", styleName);
			if(styleClass != null)
			{
				let styleClassDocs = this.findDocumentation (styleClass);
				if(styleClassDocs != null)
					styleDescription = { brief: styleClassDocs.brief, detailed: styleClassDocs.detailed };

				let classStyles = DomHelper.findChildren (styleClass, "Model.Member");
				for(let i = 0; i < classStyles.length; i++)
				{
					let style = classStyles[i];
					let name = style.attribs["name"];
					if(name != null)
					{
						let type = this.getTypeName (this.styleModel, style, styleName, name);
						if(type == null)
							type = "";

						let docs = this.findDocumentation (style);
						let description: { brief: string, detailed: string } | undefined;
						if(docs != null)
							description = { brief: docs.brief, detailed: docs.detailed };

						let found = false;
						for(let s = 0; s < styles.length; s++)
						{
							if(styles[s].name == name)
							{
								found = true;
								break;
							}
						}

						if(!found)
							styles.push ({ name: name, type: type, description: description });
					}
				}

				let parentStyleName = styleClass.attribs["parent"];
				if(parentStyleName != null)
					this.findStylesDocumentation (styles, parentStyleName);
			}
		}

		return styleDescription;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findAttributeDocumentation (skinElementName: string, attributeName: string): { brief: string, detailed: string, code: string, type: string } | null
	{
		let attributeTypeInfo = this.findAttributeType (skinElementName, attributeName);
		let typeInfo = "";
		if(attributeTypeInfo.type != AttributeType.kNoType)
		{
			typeInfo = this.typeToString (attributeTypeInfo.type);
			if(attributeTypeInfo.elementName != skinElementName)
				typeInfo += " (via " + attributeTypeInfo.elementName + ")";
		}

		if(this.classModel == null)
			return null;

		let modelClass = DomHelper.findFirstChild (this.classModel, "Model.Class", "name", attributeTypeInfo.elementName);
		if(modelClass != null)
		{
			let elem = DomHelper.findFirstChild (modelClass, "Model.Member", "name", attributeName);
			if(elem != null)
			{
				let docs = this.findDocumentation (elem);
				if(docs != null)
					return { brief: docs.brief, detailed: docs.detailed, code: docs.code, type: typeInfo };
			}
		}

		if(typeInfo.length == 0)
			return null;

		let def = this.skinElementCache[skinElementName.toUpperCase ()];
		if(def != null && def.parent != null)
		{
			let parentType = this.findAttributeType (def.parent, attributeName);
			if(parentType.type == attributeTypeInfo.type || parentType.type == AttributeType.kString)
			{
				let result = this.findAttributeDocumentation (def.parent, attributeName);
				if(result != null)
					result.type = typeInfo;

				return result;
			}
		}

		return { brief: attributeName, detailed: "", code: "", type: typeInfo };
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findEnumDocumentation (tagName: string, enumName: string, entryName: string): { brief: string, detailed: string, code: string } | null
	{
		if(this.classModel == null)
			return null;

		let enumeration = DomHelper.findFirstChild (this.classModel, "Model.Enumeration", "name", tagName + "." + enumName);
		if(enumeration != null)
		{
			let elem = DomHelper.findFirstChild (enumeration, "Model.Enumerator", "name", entryName);
			if(elem != null)
			{
				let docs = this.findDocumentation (elem);
				if(docs != null)
					return { brief: docs.brief, detailed: docs.detailed, code: docs.code };
			}
		}

		let element = this.skinElementCache[tagName.toUpperCase ()];
		if(element != null && element.parent != null)
			return this.findEnumDocumentation (element.parent, enumName, entryName);

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static findDocumentation (elem: Element)
	{
		let docs = DomHelper.findFirstChild (elem, "Model.Documentation");
		if(docs == null)
			return null;

		let briefElem = DomHelper.findFirstChild (docs, "String", "x:id", "brief");
		let detailedElem = DomHelper.findFirstChild (docs, "String", "x:id", "detailed");
		let codeElem = DomHelper.findFirstChild (docs, "String", "x:id", "code");

		let brief: string | null = null;
		let detailed: string | null = null;
		let code: string | null = null;

		if(briefElem != null)
			brief = briefElem.attribs["text"];

		if(detailedElem != null)
			detailed = detailedElem.attribs["text"];

		if(codeElem != null)
			code = codeElem.attribs["text"];

		if((brief == null || brief.length == 0) && (detailed == null || detailed.length == 0) && (code == null || code.length == 0))
			return null;

		if(brief == null || brief.length == 0)
			brief = elem.attribs["name"];

		if(brief == null)
			brief = "";
		if(detailed == null)
			detailed = "";
		if(code == null)
			code = "";

		return { brief: brief, detailed: detailed, code: code };
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	private static parseType (typeName: string)
	{
		typeName = typeName.toLowerCase ();
		if(typeName == "metric")
			typeName = "float";

		for(let val in attributeNames)
		{
			let attributeType = +val as keyof typeof attributeNames;
			if(attributeNames[attributeType] == typeName)
				return attributeType;
		}

		// composite types
		let result = AttributeType.kNoType;
		if(typeName.indexOf ("|") > -1)
		{
			let strTypes = typeName.split ("|");
			for(let i = 0; i < strTypes.length; i++)
				result |= this.parseType (strTypes[i].trim ());
		}

		if(result == AttributeType.kNoType)
			console.warn ("Unknown type: '" + typeName + "'");

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static typeToString (type: AttributeType)
	{
		let result = attributeNames[type];
		if(result != null && result.length > 0)
			return result;

		// composite types
		result = "";
		for(let t in AttributeType)
		{
			if(isNaN (+t))
				continue;

			if((type & +t) > 0)
			{
				if(result.length > 0)
					result += " | ";

				result += this.typeToString (+t);
			}
		}

		return result;
	}
}
