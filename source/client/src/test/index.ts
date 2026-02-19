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
// Filename    : client/src/test/index.ts
// Description : Test Index
//
//************************************************************************************************

import * as path from 'path';
import * as Mocha from 'mocha';
import { glob } from 'glob';

//////////////////////////////////////////////////////////////////////////////////////////////////

export function run (): Promise<void>
{
	// Create the mocha test
	const mocha = new Mocha ({
		ui: 'tdd',
	});
	//mocha.useColors (true);
	mocha.timeout (100000);

	const testsRoot = __dirname;

	return glob.glob ('**.test.js', { cwd: testsRoot }).then (async files =>
	{
		// Add files to the test suite
		files.forEach (f => mocha.addFile (path.resolve (testsRoot, f)));

		try
		{
			// Run the mocha test
			await new Promise<void> ((resolve, reject) =>
			{
				mocha.run (failures =>
				{
					if(failures > 0)
						reject(`${failures} tests failed.`);
					else
						resolve();
				});
			});
		}
		catch(err)
		{
			console.error (err);
			throw err;
		}
	});
}
