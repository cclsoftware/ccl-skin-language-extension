import { readFile, writeFile } from "fs";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath (import.meta.url);
const __dirname = dirname (__filename);

readFile (__dirname + "/../package.json", "utf8", (err, data) =>
{
	if(err)
	{
		console.error (err);
		return;
	}

	let object = JSON.parse (data);
	delete object["scripts"];
	delete object["dependencies"];
	delete object["devDependencies"];
	object["main"] = "./extension";

	writeFile (__dirname + "/../dist/package.json", JSON.stringify (object, null, '\t'), (err) =>
	{
		if(err)
			console.error (err);
	});
});

let convertFromRST = (text) =>
{
	let lines = text.split ("\n");
	let result = "";
	let isWithinHeader = false;
	let isWithinSubheader = false;
	for(let i = 0; i < lines.length; i++)
	{
		if(lines[i].startsWith ("====="))
			isWithinSubheader = !isWithinSubheader;
		else if(lines[i].startsWith ("#####"))
			isWithinHeader = !isWithinHeader;
		else
		{
			let prefix = "";
			let postfix = "";
			if(isWithinHeader)
				prefix = "# ";
			else if(isWithinSubheader)
			{
				prefix = "**";
				postfix = "**";
			}

			result += prefix + lines[i].replace (/:code:/g, "") + postfix + "\n";
		}
	}

	return result;
};

let truncate = (text) =>
{
	let lines = text.split ("\n");
	let result = "";
	let currentVersionFound = false;
	for(let i = 0; i < lines.length; i++)
	{
		if(i > 0)
			result += "\n";

		if(lines[i].startsWith ("**"))
		{
			if(currentVersionFound)
				break;
			else if(lines[i].match (/^\*\*\d+\.\d+\.\d+ \(\d\d\d\d-[\d|X][\d|X]-[\d|X][\d|X]\)\*\*$/) != null)
				currentVersionFound = true;
		}

		result += lines[i];
	}

	result += "Find more information including the full changelog at https://github.com/cclsoftware/ccl-skin-language-extension\n";

	return result;
};

readFile (__dirname + "/../changelog.md", "utf8", (err, data) =>
{
	if(err)
	{
		console.error (err);
		return;
	}

	let result = truncate (data);

	writeFile (__dirname + "/../dist/CHANGELOG.md", result, (err) =>
	{
		if(err)
			console.error (err);
	});
});
