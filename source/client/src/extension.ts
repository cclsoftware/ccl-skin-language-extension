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
// Filename    : client/src/extension.ts
// Description : Extension Client
//
//************************************************************************************************

import { workspace, ExtensionContext, window } from 'vscode';
import * as fs from "fs";

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
	NotificationType
} from 'vscode-languageclient/node';

let client: LanguageClient;

//////////////////////////////////////////////////////////////////////////////////////////////////

export function activate (context: ExtensionContext)
{
	// The server is implemented in node
	
	let serverModule = context.asAbsolutePath ('server.js');
	if(!fs.existsSync (serverModule))
		serverModule = context.asAbsolutePath ('server/out/server.js'); // this is the case for debug builds

	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: {
			module: serverModule,
			transport: TransportKind.ipc
		},
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for xml documents
		documentSelector: [{ scheme: 'file', language: 'xml' }],
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher ('**/.clientrc')
		},
		markdown: {
			isTrusted: true
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient (
		'CCLSkinLanguageServer',
		'CCL Skin Language Server',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start ();
}

//////////////////////////////////////////////////////////////////////////////////////////////////

export function deactivate (): Thenable<void> | undefined
{
	if(!client)
		return undefined;

	return client.stop ();
}

//////////////////////////////////////////////////////////////////////////////////////////////////

window.onDidChangeActiveTextEditor (e =>
{
	if(e != null)
		client.sendNotification (new NotificationType ("onDidChangeActiveTextEditor"), e.document.uri.toString ());
});
