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
// Filename    : server/src/filesystemhelper.ts
// Description : Filesystem Helper
//
//************************************************************************************************

import * as url from 'url';
import * as fs from 'fs';
import * as Path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';

//************************************************************************************************
// FilesystemHelper
//************************************************************************************************

export const kRootMarker = "repo.json";
export const kDefaultSkinsLocation = "skins";

export const kSkinElementsModelName = "Skin Elements.classModel";
export const kVisualStylesModelName = "Visual Styles.classModel";

const kLocalesDirectory = "locales";

//////////////////////////////////////////////////////////////////////////////////////////////////

export class FilesystemHelper
{
	private static uriCache: { [fullUri: string]: string | undefined } = {};
	private static documents: { get (uri: string): TextDocument | undefined } | null = null;

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static setDocuments (documents: { get (uri: string): TextDocument | undefined })
	{
		this.documents = documents;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static getDocumentText (uri: string, forceUpdate: boolean): string | null
	{
		let textDocument;
		if(this.documents != null)
		{
			if(!uri.startsWith ("file://"))
				uri = "file://" + uri;

			textDocument = this.documents.get (uri);
		}

		if(textDocument == null)
		{
			if(!forceUpdate)
				return null;

			uri = FilesystemHelper.removeProtocol (uri);
			if(fs.existsSync (uri) && !fs.statSync (uri).isDirectory ())
				return fs.readFileSync (uri).toString ();
			else
				return null;
		}
		else
			return textDocument.getText ();
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findRootDirectory (documentUri: string, recognitionPath = kRootMarker)
	{
		let root = this.removeProtocol (documentUri);
		while(fs.existsSync (root))
		{
			if(fs.existsSync (root + "/" + recognitionPath))
			{
				if(!root.endsWith ("/"))
					root += "/";

				return root;
			}

			root = root.substring (0, root.lastIndexOf ("/"));
		}

		return null;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findClassModelPaths (path: string)
	{
		let skinElements: string | null = null;
		let visualStyles: string | null = null;
		let root = FilesystemHelper.findRootDirectory (path);
		if(root != null)
		{
			try
			{
				let obj = JSON.parse (fs.readFileSync (root + kRootMarker).toString ());
				if(obj.classmodels != null && Array.isArray (obj.classmodels))
				{
					for(let i = 0; i < obj.classmodels.length; i++)
					{
						let relativePath = obj.classmodels[i];
						if(skinElements == null)
						{
							let skinElementsPath = Path.join (root, relativePath, kSkinElementsModelName);
							if(fs.existsSync (skinElementsPath))
								skinElements = skinElementsPath;
						}

						if(visualStyles == null)
						{
							let visualStylesPath = Path.join (root, relativePath, kVisualStylesModelName);
							if(fs.existsSync (visualStylesPath))
								visualStyles = visualStylesPath;
						}
					}
				}
			}
			catch (e)
			{}
		}

		if(skinElements == null || visualStyles == null)
			return null;

		return { skinElements: skinElements, visualStyles: visualStyles };
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findSkinsLocations (path: string)
	{
		let root = FilesystemHelper.findRootDirectory (path);
		if(root != null && fs.existsSync (root + kRootMarker))
		{
			try
			{
				let obj = JSON.parse (fs.readFileSync (root + kRootMarker).toString ());
				if(obj.skins != null && Array.isArray (obj.skins))
					return obj.skins as string[];
			}
			catch (e)
			{}
		}

		return [];
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static findLocales (path: string)
	{
		let result: string[] = [];
		let root = FilesystemHelper.findRootDirectory (path);
		if(root != null && fs.existsSync (root + kRootMarker))
		{
			try
			{
				let obj = JSON.parse (fs.readFileSync (root + kRootMarker).toString ());
				if(obj.translations != null && Array.isArray (obj.translations))
				{
					let translationsPaths = obj.translations as string[];
					for(let i = 0; i < translationsPaths.length; i++)
					{
						let localesPath = Path.join (root, translationsPaths[i], kLocalesDirectory);
						if(fs.existsSync (localesPath))
							result.push (localesPath);
					}
				}
			}
			catch (e)
			{}
		}

		return result;
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static async traverseDirectory (path: string, onXMLFile: (filePath: string, fileContent: string) => Promise<void> | void)
	{
		let files = fs.readdirSync (path, "utf-8");
		for(let i = 0; i < files.length; i++)
		{
			let filePath = path + files[i];
			if(!fs.existsSync (filePath))
				continue;

			if(fs.statSync (filePath).isDirectory ())
				await this.traverseDirectory (filePath + "/", onXMLFile);
			else
			{
				if(files[i].endsWith (".xml"))
				{
					let documentText = this.getDocumentText (filePath, true);
					if(documentText != null)
						await onXMLFile (filePath, documentText);
				}
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////

	public static removeProtocol (fileUrl: string)
	{
		let cached = this.uriCache[fileUrl];
		if(cached != null)
			return cached;

		let result = "";
		fileUrl = fileUrl.replace (/%3A/i, ":").replace (/%2B/ig, "+");
		if(fileUrl.startsWith ('file'))
		{
			let temp = new url.URL (fileUrl);
			if(temp.pathname != null)
			{
				result = temp.pathname + temp.hash;
				if(result.startsWith ("/") && result.indexOf (":") > -1) // remove slash before Windows drive letters
					result = result.substring (1);
			}
		}
		else
			result = fileUrl;

		result = decodeURI (result);
		let colonIndex = result.indexOf (":");
		if(colonIndex > -1)
			result = result.substring (0, colonIndex).toUpperCase () + result.substring (colonIndex);

		this.uriCache[fileUrl] = result;

		return result;
	}
}
