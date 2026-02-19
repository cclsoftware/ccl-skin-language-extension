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
// Filename    : server/src/test/fulldirectorytraverse.ts
// Description : Full Directory Traverse
//
//************************************************************************************************

import { SkinDocumentChecker } from '../src/skindocumentchecker';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ClassModelManager } from '../src/classmodelmanager';
import { SkinDefinitionParser } from '../src/skindefinitionparser';
import { FilesystemHelper, kDefaultSkinsLocation } from '../src/filesystemhelper';

let totalErrors = 0;
let totalWarnings = 0;

let ignorePatterns: string[] = [];
for(let i = 0; i < process.argv.length; i++)
{
	let val = process.argv[i];
	if(val == "-ignore" && process.argv.length > i + 1)
	{
		ignorePatterns = process.argv[i + 1].split (" ");
		break;
	}
}

let root = FilesystemHelper.findRootDirectory (process.cwd ());
if(root == null)
{
	console.error ("The current working directory does not seem to be within a repository containing a repo.json at its root.");
	process.exit (1);
}

let models = FilesystemHelper.findClassModelPaths (root);
if(models == null)
{
	console.error ("Could not find Skin Elements.classModel and Visual Styles.classModel in the locations defined in repo.json.");
	process.exit (1);
}

let skinsLocations = FilesystemHelper.findSkinsLocations (root);
if(skinsLocations.indexOf (kDefaultSkinsLocation) == -1)
	skinsLocations.push (kDefaultSkinsLocation);

ClassModelManager.loadClassModel (models.skinElements);
ClassModelManager.loadStyleModel (models.visualStyles);

let textDocument: TextDocument | null = null;
FilesystemHelper.setDocuments ({
	get: (uri: string) =>
	{
		if(textDocument != null && uri == textDocument.uri)
			return textDocument;
	}
});

SkinDocumentChecker.setHasDiagnosticRelatedInformationCapability (true);

let time = Date.now ().valueOf ();
let currentRoot = "";
FilesystemHelper.traverseDirectory (root, async (filePath, fileContent) =>
{
	// ignore our own test skin files (which are supposed to contain errors)
	if(filePath.indexOf ("testFixture/MySkinPack") > -1)
		return;

	for(let i = 0; i < ignorePatterns.length; i++)
	{
		if(filePath.indexOf (ignorePatterns[i]) > -1)
			return;
	}

	let diagnostics: Diagnostic[] = [];
	textDocument = TextDocument.create ("file://" + filePath, "xml", 1, fileContent);
	try
	{
		if(SkinDocumentChecker.getSkinRoot (textDocument.uri) == null)
			return; // not a skin file

		let root = SkinDefinitionParser.findSkinPackRoot (FilesystemHelper.removeProtocol (textDocument.uri));
		if(root != currentRoot)
		{
			if(root == null)
				console.error ("Root could not be found. (" + textDocument.uri + ")");
			else
				currentRoot = root;

			SkinDefinitionParser.buildDefinitionDirectory (textDocument, skinsLocations);
		}

		diagnostics.push (...await SkinDocumentChecker.checkDocument (textDocument));
	}
	catch(e: any)
	{
		let error = (<Error>e);
		console.error (error.message);
		if(error.stack != null)
			console.error (error.stack);
	
		totalErrors++;
	}

	for(let i = 0; i < diagnostics.length; i++)
	{
		let prefix = "";
		if(diagnostics[i].severity == DiagnosticSeverity.Error)
		{
			totalErrors++;
			prefix = "Error: ";
		}
		else if(diagnostics[i].severity == DiagnosticSeverity.Warning)
		{
			totalWarnings++;
			prefix = "Warning: ";
		}

		let postfix = "";
		let related = diagnostics[i].relatedInformation;
		if(related && related[0])
		{
			let message = related[0].message.split ("\n")[0];
			if(message.length > 0 && (related[0].location.uri != ("file://" + filePath) || !SkinDefinitionParser.equalRange (related[0].location.range, diagnostics[i].range)))
				postfix = ` (${message} ${related[0].location.uri}:${related[0].location.range.start.line + 1}:${related[0].location.range.start.character + 1})`;
		}

		console.log (prefix + diagnostics[i].message + " at " + filePath + ":" + (diagnostics[i].range.start.line + 1) + ":" + (diagnostics[i].range.start.character + 1) + postfix);
	}
}).then (() =>
{
	console.log ("Total Errors: " + totalErrors);
	console.log ("Total Warnings: " + totalWarnings);

	console.log ("Finished in " + (Math.round ((Date.now ().valueOf () - time) / 100) / 10) + "s.");

	if(totalErrors > 0)
		process.exitCode = 1; // error
});
