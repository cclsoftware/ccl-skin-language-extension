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
// Filename    : client/src/test/helper.ts
// Description : Test Helper
//
//************************************************************************************************

import * as vscode from 'vscode';
import * as path from 'path';

export let doc: vscode.TextDocument;
export let editor: vscode.TextEditor;
export let documentEol: string;
export let platformEol: string;

//////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Activates the extension
 */
export async function activate (docUri: vscode.Uri)
{
	// The extensionId is `publisher.name` from package.json
	const ext = vscode.extensions.getExtension ('cclsoftware.ccl-skin-language')!;
	await ext.activate ();
	try
	{
		doc = await vscode.workspace.openTextDocument (docUri);
		editor = await vscode.window.showTextDocument (doc);
		await sleep (2000); // Wait for server activation
	}
	catch (e)
	{
		console.error (e);
	}
}

//////////////////////////////////////////////////////////////////////////////////////////////////

export async function sleep (ms: number)
{
	return new Promise (resolve => setTimeout (resolve, ms));
}

//////////////////////////////////////////////////////////////////////////////////////////////////

export const getDocPath = (p: string) =>
{
	return path.resolve (__dirname, '../../testFixture', p);
};

//////////////////////////////////////////////////////////////////////////////////////////////////

export const getDocUri = (p: string) =>
{
	return vscode.Uri.file (getDocPath (p));
};

//////////////////////////////////////////////////////////////////////////////////////////////////

export async function setTestContent (content: string): Promise<boolean>
{
	const all = new vscode.Range (doc.positionAt (0), doc.positionAt (doc.getText ().length));
	return editor.edit (eb => eb.replace (all, content));
}
