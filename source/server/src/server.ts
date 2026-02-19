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
// Filename    : server/src/server.ts
// Description : Extension Server
//
//************************************************************************************************

import {
	createConnection,
	TextDocuments,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	Hover,
	DefinitionParams,
	DocumentColorParams,
	ColorPresentationParams,
	ColorPresentation,
	TextEdit,
	NotificationType,
	ReferenceParams,
	RenameParams,
	WorkspaceEdit,
	PrepareRenameParams,
	Location
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { ClassModelManager } from './classmodelmanager';
import { SkinDocumentChecker, kValidationDelay } from './skindocumentchecker';
import { SkinDefinitionParser } from './skindefinitionparser';
import * as fs from 'fs';
import * as Path from 'path';
import { FilesystemHelper, kDefaultSkinsLocation, kSkinElementsModelName, kVisualStylesModelName } from './filesystemhelper';
import { IntelliSenseProvider } from './intellisenseprovider';

// Create a connection for the server, using Node's IPC as a transport.
let connection = createConnection ();

// Create a simple text document manager.
let documents: TextDocuments<TextDocument> = new TextDocuments (TextDocument);

let documentCheckTimeout: NodeJS.Timeout | null = null;

let hasConfigurationCapability: boolean = false;

let colorInfoRequest: (() => void) | null = null;

//////////////////////////////////////////////////////////////////////////////////////////////////

connection.onInitialize ((params: InitializeParams) =>
{
	let capabilities = params.capabilities;

	// If the client does not support the `workspace/configuration` request,
	// we fall back to using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);

	SkinDocumentChecker.setHasDiagnosticRelatedInformationCapability (!!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	));

	const result: InitializeResult = {
		capabilities:
		{
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider:
			{
				resolveProvider: true,
				triggerCharacters: IntelliSenseProvider.kTriggerCharacters
			},
			hoverProvider: true,
			definitionProvider: true,
			colorProvider: true,
			referencesProvider: true,
			renameProvider: {
				prepareProvider: true
			}
		}
	};

	FilesystemHelper.setDocuments (documents);

	return result;
});

//////////////////////////////////////////////////////////////////////////////////////////////////

connection.onInitialized (() =>
{
	if (hasConfigurationCapability)
	{
		// Register for all configuration changes.
		connection.client.register (DidChangeConfigurationNotification.type, undefined);
	}
});

//////////////////////////////////////////////////////////////////////////////////////////////////

interface ExtensionSettings
{
	skinElementsPath?: string;
	visualStylesPath?: string;
	skinsLocations?: string[];
}

//////////////////////////////////////////////////////////////////////////////////////////////////

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExtensionSettings = { skinElementsPath: "", visualStylesPath: "", skinsLocations: [] };
let globalSettings: ExtensionSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<ExtensionSettings>> = new Map ();
let latestSkinElementsPath = "";
let latestVisualStylesPath = "";
let skinsLocations: string[] = [];

//////////////////////////////////////////////////////////////////////////////////////////////////

connection.onDidChangeConfiguration (change =>
{
	skinsLocations = [];
	if(hasConfigurationCapability)
	{
		// Reset all cached document settings
		documentSettings.clear ();
	}

	// Revalidate all open text documents
	documents.all ().forEach (validateTextDocument);
});

//////////////////////////////////////////////////////////////////////////////////////////////////

// Only keep settings for open documents
documents.onDidClose (e =>
{
	documentSettings.delete (e.document.uri);
});

//////////////////////////////////////////////////////////////////////////////////////////////////

connection.onNotification (new NotificationType ("onDidChangeActiveTextEditor"), (e: any) =>
{
	let url = <string>e;
	let doc = documents.get (url);
	if(doc != null)
		validateTextDocument (doc);
});

//////////////////////////////////////////////////////////////////////////////////////////////////

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent (change =>
{
	SkinDocumentChecker.abortCurrentCheck ();

	const later = () =>
	{
		documentCheckTimeout = null;
		validateTextDocument (change.document);
	};

	if(documentCheckTimeout != null)
		clearTimeout (documentCheckTimeout);

	documentCheckTimeout = setTimeout (later, kValidationDelay);
});

//////////////////////////////////////////////////////////////////////////////////////////////////

async function findSettings (uri: string)
{
	let settings = globalSettings;
	if(hasConfigurationCapability)
	{
		let result = documentSettings.get (uri);
		if(!result)
		{
			result = connection.workspace.getConfiguration (
			{
				scopeUri: uri,
				section: 'CCLskin'
			});
			documentSettings.set (uri, result);
		}

		settings = await result;
	}

	return settings;
}

//////////////////////////////////////////////////////////////////////////////////////////////////

function loadModels (documentUri: string, skinElementsPath: string, visualStylesPath: string)
{
	let skinElementsPathNeeded = skinElementsPath.length == 0 || !fs.existsSync (skinElementsPath);
	let visualStylesPathNeeded = visualStylesPath.length == 0 || !fs.existsSync (visualStylesPath);

	if(skinElementsPathNeeded || visualStylesPathNeeded)
	{
		let models = FilesystemHelper.findClassModelPaths (documentUri);
		if(models == null)
			return;

		if(skinElementsPathNeeded)
			skinElementsPath = models.skinElements;
		if(visualStylesPathNeeded)
			visualStylesPath = models.visualStyles;
	}

	if(skinElementsPath.length > 0 && Path.basename (skinElementsPath) != kSkinElementsModelName)
		skinElementsPath = Path.join (skinElementsPath, kSkinElementsModelName);
	if(visualStylesPath.length > 0 && Path.basename (visualStylesPath) != kVisualStylesModelName)
		visualStylesPath = Path.join (visualStylesPath, kVisualStylesModelName);

	if(latestSkinElementsPath != skinElementsPath || latestVisualStylesPath != visualStylesPath)
	{
		latestSkinElementsPath = skinElementsPath;
		latestVisualStylesPath = visualStylesPath;
		ClassModelManager.reset ();
	}

	ClassModelManager.loadClassModel (skinElementsPath);
	ClassModelManager.loadStyleModel (visualStylesPath);
	let localesPaths = FilesystemHelper.findLocales (documentUri);
	for(let i = 0; i < localesPaths.length; i++)
		ClassModelManager.loadLanguages (localesPaths[i]);
}

//////////////////////////////////////////////////////////////////////////////////////////////////

async function validateTextDocument (textDocument: TextDocument): Promise<void>
{
	// For now we get the settings for every validate run.
	let skinElementsPath = "";
	let visualStylesPath = "";
	let settings = await findSettings (textDocument.uri);
	if(settings != null)
	{
		skinElementsPath = settings.skinElementsPath ? settings.skinElementsPath : "";
		visualStylesPath = settings.visualStylesPath ? settings.visualStylesPath : "";
	}
	loadModels (textDocument.uri, skinElementsPath, visualStylesPath);

	if(skinsLocations.length == 0)
	{
		if(settings != null && settings.skinsLocations != null)
		{
			if(!Array.isArray (settings.skinsLocations))
				settings.skinsLocations = ["" + settings.skinsLocations];

			skinsLocations = [];
			skinsLocations.push (...settings.skinsLocations);
		}

		let repoLocations = FilesystemHelper.findSkinsLocations (textDocument.uri);
		for(let i = 0; i < repoLocations.length; i++)
		{
			if(skinsLocations.indexOf (repoLocations[i]) == -1)
				skinsLocations.push (repoLocations[i]);
		}

		if(skinsLocations.indexOf (kDefaultSkinsLocation) == -1)
			skinsLocations.push (kDefaultSkinsLocation);
	}

	SkinDefinitionParser.buildDefinitionDirectory (textDocument, skinsLocations);
	SkinDocumentChecker.checkDocument (textDocument).then ((diagnostics) =>
	{
		if(colorInfoRequest != null)
		{
			colorInfoRequest ();
			colorInfoRequest = null;
		}

		// Send the computed diagnostics to VSCode.
		connection.sendDiagnostics ({ uri: textDocument.uri, diagnostics });
	})
	.catch (() =>
	{
		// console.log ("Check aborted.");
	});
}

//////////////////////////////////////////////////////////////////////////////////////////////////

connection.onHover((params: TextDocumentPositionParams): Hover | undefined =>
{
	return IntelliSenseProvider.getHoverInformation (params);
});

//////////////////////////////////////////////////////////////////////////////////////////////////

// This handler provides the initial list of the completion items.
connection.onCompletion ((textDocumentPosition: TextDocumentPositionParams): CompletionItem[] =>
{
	return IntelliSenseProvider.getCompletionInformation (textDocumentPosition);
});

//////////////////////////////////////////////////////////////////////////////////////////////////

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve ((item: CompletionItem): CompletionItem =>
{
	return IntelliSenseProvider.getCompletionResolveItem (item);
});

//////////////////////////////////////////////////////////////////////////////////////////////////

connection.onDefinition ((params: DefinitionParams): Location[] =>
{
	return IntelliSenseProvider.findDefinitions (params.textDocument.uri, params.position);
});

//////////////////////////////////////////////////////////////////////////////////////////////////

connection.onDocumentColor ((params: DocumentColorParams) =>
{
	let colorInfo = IntelliSenseProvider.getColorInformation (params.textDocument.uri);
	if(colorInfo.length == 0)
	{
		return new Promise ((resolve, _reject) => {
			colorInfoRequest = () => {
				resolve (IntelliSenseProvider.getColorInformation (params.textDocument.uri));
			};
		});
	}

	return colorInfo;
});

//////////////////////////////////////////////////////////////////////////////////////////////////

connection.onColorPresentation ((params: ColorPresentationParams) =>
{
	let colorString = IntelliSenseProvider.colorToString (params.color, params.textDocument.uri, params.range);
	if(colorString != null)
		return [ColorPresentation.create (colorString, TextEdit.replace (params.range, colorString))];
});

//////////////////////////////////////////////////////////////////////////////////////////////////

connection.onReferences ((params: ReferenceParams) =>
{
	return IntelliSenseProvider.findReferences (params.textDocument.uri, params.position, skinsLocations);
});

//////////////////////////////////////////////////////////////////////////////////////////////////

connection.onPrepareRename ((params: PrepareRenameParams) =>
{
	let result = IntelliSenseProvider.findSymbolAtPosition (params.textDocument.uri, params.position, true);
	if(result != null)
	{
		return {
			range: result.range,
			placeholder: result.symbolName
		};
	}

	return null;
});

//////////////////////////////////////////////////////////////////////////////////////////////////

connection.onRenameRequest (async (params: RenameParams) =>
{
	let references = await IntelliSenseProvider.findReferences (params.textDocument.uri, params.position, skinsLocations);
	let edit: WorkspaceEdit = { changes: {} };
	if(edit.changes != null)
	{
		for(let i = 0; i < references.length; i++)
		{
			if(edit.changes[references[i].uri] == null)
				edit.changes[references[i].uri] = [];

			edit.changes[references[i].uri].push ({ range: references[i].range, newText: params.newName });
		}
	}

	return edit;
});

//////////////////////////////////////////////////////////////////////////////////////////////////

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen (connection);

// Listen on the connection
connection.listen ();
