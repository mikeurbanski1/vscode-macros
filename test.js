const vscode = require('vscode');

/**
 * Macro configuration settings
 * { [name: string]: {              ... Name of the macro
 *    no: number,                   ... Order of the macro
 *    func: ()=> string | undefined ... Name of the body of the macro function
 *  }
 * }
 */
module.exports.macroCommands = {
   ConvertToDestructuredObjectInput: {
      no: 2,
      func: convertToDestructuredObjectInput
   },
   SplitLineToMultiLine: {
      no: 1,
      func: convertLineToMultiline
   },
   ConvertStringToSingleQuotes: {
      no: 3,
      func: () => changeStringChar("'")
   },
   ConvertStringToBackticks: {
      no: 4,
      func: () => changeStringChar('`')
   },
   ConvertJsonToJavascript: {
      no: 5,
      func: convertJsonToJavascript
   },
   LogMessage: {
      no: 6,
      func: generateLogMessage
   }
};

async function generateLogMessage() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
       return 'Editor is not opening.';
    }
    const document = editor.document;
    const loggerDetails = getLoggerDetails(document);
    if (!loggerDetails) {
        return;
    }

    console.log('got logger details', loggerDetails);

    const selection = editor.selection;

    const methodName = await getMethodName(document, selection);

    const prefix = await getLoggerPrefix(loggerDetails.hasPrefix, methodName, document, selection.start.line);
    console.log('full prefix:', prefix);

    const logString = prefix ? `${prefix} ` : '';

    const logExpr = `${loggerDetails.logUsage}.info('${logString}');`;
    editor.edit(editBuilder => {
        editBuilder.replace(selection, logExpr);
    }).then(() => {
        vscode.commands.executeCommand('cursorMove', {
            to: 'left',
            by:'character',
            value: 3
        });
    });
}

async function getLoggerPrefix(hasClassPrefix, methodName, document, lineNum) {
    let prefix = methodName ? `[${methodName}]` : '';
    if (!hasClassPrefix) {
        const className = await getClassName(document, lineNum);
        if (className) {
            prefix = `[${className}]${prefix}`;
        }
    }
    return prefix;
}

// Ensures loggerv3 is imported, and finds the initialization of the log to see if it is initialized with a standard prefix
// also determines if the logger should be referenced using `logger` or `this.logger`, based on example usage
// does not handle nested methods or nested classes
function getLoggerDetails(document) {
    let line;
    let foundLoggerInit = false;
    for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
        line = document.lineAt(lineNum).text;
        if (line.includes('LoggerV3.getLambdaLogger()')) {
            foundLoggerInit = true;
            console.log('Found logger init line:', line);
            break;
        }

        if (line.includes('LoggerWrapper.getLogger')) {
            foundLoggerInit = true;
            console.log('Found logger init line:', line);
            break;
        }
    }

    if (!foundLoggerInit) {
        console.log('Could not find a line initializing a logger');
        return null;
    }

    const hasPrefix = line.includes('prefix:');
    console.log('hasPrefix', hasPrefix);

    // javascript does not support optional capture groups, so we just have to match the regex in general and then check the string
    const usageRegex = /(?:this\.)?logger\.(debug|info|warn|error)/;
    let logUsage;
    for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
        line = document.lineAt(lineNum).text;
        const r = usageRegex.exec(line);
        if (r) {
            console.log('found log message line:', JSON.stringify(r, null, 2));
            if (r[0].startsWith('this.')) {
                logUsage = 'this.logger';
            } else {
                logUsage = 'logger';
            }
            console.log('log usage:', logUsage);
            break;
        }
    }

    if (!logUsage) {
        console.log('Could not find log usage example');
        logUsage = 'logger';
    }

    return { logUsage, hasPrefix };
}

// gets the name of the current method by inspecting the symbols and finding either:
// a symbol of type `Method` (5) that contains the current cursor line, or
// a symbole of type `Variable` that is not within a `Method` that contains the current line (handles `const f = () => ...`)
async function getMethodName(document, selection) {
    const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
    const lineNum = selection.start.line;

    const container = findLowestContainer(symbols, lineNum);

    if (!container) {
        console.log('Could not find any object containing the cursor');
        return null;
    }

    console.log('found container', JSON.stringify(container, null, 2));
    return container.name;
}

// recursively checks the symbols and their children to find a suitable container (method) for the current line
// if it finds a class that contains the current line, then check the classes children until finding (presumably) a method with the current line
// the behavior is undefined if the current line is a member of a class, e.g. a private variable defined at the top of the class, but not within a method. Do not do it.
// if there is not a class that contains the current line, then this method will assume that the container of this line, if it exists, is a const function
function findLowestContainer(symbols, lineNum, depth = 0) {
    console.log('in find lowest container, depth =', depth, 'symbols.length =', symbols.length);
    let container = symbols.find((s) => {
        console.log(`checking symbol (kind: ${s.kind}):`, JSON.stringify(s, null, 2));
        return s.location.range.start.line <= lineNum && s.location.range.end.line >= lineNum;
    });

    console.log(`container result (kind = ${container?.kind}):`, JSON.stringify(container, null, 2));

    if (!container) {
        return null;
    }

    if (container.kind === 4) {
        // 4 = class
        container = findLowestContainer(container.children, lineNum, depth + 1) || container;
    }

    return container;
}

// gets the name of the class that contains the current cursor line, if it exists
async function getClassName(document, lineNum) {
    const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
    const container = symbols.find((s) => {
        console.log(`checking symbol (kind: ${s.kind}):`, JSON.stringify(s, null, 2));
        return s.location.range.start.line <= lineNum && s.location.range.end.line >= lineNum && s.kind === 4;
    });
    return container?.name;
}

function convertJsonToJavascript() {
   const indentSize = 4;
   const editor = vscode.window.activeTextEditor;
   if (!editor) {
      return 'Editor is not opening.';
   }
   const document = editor.document;
   const selection = editor.selection;

   const selectedLine = document.lineAt(selection.start.line).text;
   console.log('selected line', selectedLine);

   const indentLevel = getLineIndentLevel(selectedLine, indentSize);

   const text = document.getText(selection);
   console.log('text', text);
   const o = JSON.parse(text);
   const newStr = processObjectForPrinting(o, indentSize, indentLevel + 1);
   console.log(newStr);
   editor.edit(editBuilder => {
      editBuilder.replace(selection, newStr);
   });
}

function processObjectForPrinting(obj, indentSize, level = 1) {
    let str = '{\n';
    const prefix = ' '.repeat(level * indentSize)

    const keys = Object.keys(obj);

    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = obj[k];
        if (i > 0) {
            str += ',\n'
        }
        str += `${prefix}${k}: `;
        if (typeof v === 'string') {
            str += `'${v}'`
        } else if (Array.isArray(v)) {
            str += '[\n';
            for (let j = 0; j < v.length; j++) {
                if (j > 0) {
                    str += ',';
                }
                str += `${' '.repeat((level + 1) * indentSize)}${processObjectForPrinting(v[j], indentSize, level + 2)}`
            }
            str += `\n${prefix}]`
        } else if (typeof v === 'object') {
            str += processObjectForPrinting(v, indentSize, level + 1);
        } else {
            str += v;
        }
    }

    return `${str}\n${' '.repeat((level - 1) * indentSize)}}`;
}

function convertLineToMultiline() {
   const indentSize = 4;
   const editor = vscode.window.activeTextEditor;
   if (!editor) {
      return 'Editor is not opening.';
   }
   const document = editor.document;
   const selection = editor.selection;
   const text = document.getText(selection);

   console.log('selected text', text);

   console.log(JSON.stringify(selection, null, 2));

   const selectedLine = document.lineAt(selection.start.line).text;
   console.log('selected line', selectedLine);

   let firstBrace = selectedLine.indexOf('{');

   if (firstBrace === -1) {
      return;
   }

   let finalStr = '';

   const indentLevel = getLineIndentLevel(selectedLine, indentSize);
   let lastClosingBraceIndex = -1;


   while (true) {
      console.log(`Processing the object with an opening brace at index ${firstBrace}`);

      let newStr = selectedLine.substring(lastClosingBraceIndex + 1, firstBrace + 1) + '\n';
      finalStr += newStr;

      console.log('newStr:', newStr);
      console.log('finalStr:', finalStr);
      
      const { finalObjectString, closingBraceIndex } = parseObject(selectedLine, firstBrace, indentLevel + 1, indentSize, '');
      lastClosingBraceIndex = closingBraceIndex;

      finalStr += finalObjectString;

      console.log('final result after this object');
      console.log(finalStr);

      firstBrace = selectedLine.indexOf('{', closingBraceIndex);

      if (firstBrace === -1) {
         console.log('found the last brace');
         break;
      } else {
         if (selectedLine.trimEnd().length === firstBrace + 1) {
            console.log('The brace was the end of the line - breaking loop');
            break;
         }
      }
   }

   finalStr += selectedLine.substring(lastClosingBraceIndex + 1);

   const lineSelection = new vscode.Selection(selection.start.line, 0, selection.start.line, selectedLine.length);
   console.log(lineSelection);

   console.log('the final string');
   console.log(finalStr);

   editor.edit(editBuilder => {
      editBuilder.replace(lineSelection, finalStr);
   });
}

function parseObject(line, openingBraceIndex, indentLevel, indentSize, newStr) {
   console.log(`Entering parseObject - openingBraceIndex: ${openingBraceIndex}, indentLevel: ${indentLevel}`);
   console.log(newStr);

   let currentToken = '';

   for (let charIndex = openingBraceIndex + 1; charIndex < line.length; charIndex++) {
      const char = line[charIndex];

      if (char === '{') {
         console.log(`Found { at index ${charIndex} (indent level ${indentLevel})`);
         console.log(`string to append before recursion (indent level ${indentLevel}):`, ' '.repeat(indentLevel * indentSize) + currentToken.trim() + ' {\n');
         newStr += ' '.repeat(indentLevel * indentSize) + currentToken.trim() + ' {\n';
         let { finalObjectString, closingBraceIndex } = parseObject(line, charIndex, indentLevel + 1, indentSize, '');
         console.log(`closingBraceIndex and finalObjectString after returning from recursion (indent level ${indentLevel}):`, closingBraceIndex, finalObjectString);
         newStr += finalObjectString;
         charIndex = closingBraceIndex;
         currentToken = '';
      } else if (char === '}') {
         console.log(`Found } at index ${charIndex} (indent level ${indentLevel})`);
         console.log(`string to append (indent level ${indentLevel}):`, ' '.repeat(indentLevel * indentSize) + currentToken.trim() + '\n' + ' '.repeat((indentLevel - 1) * indentSize) + '}');
         newStr += ' '.repeat(indentLevel * indentSize) + currentToken.trim() + '\n' + ' '.repeat((indentLevel - 1) * indentSize) + '}';
         return { finalObjectString: newStr, closingBraceIndex: charIndex };
      } else if (char === ',') {
         console.log(`Found , at index ${charIndex} (indent level ${indentLevel})`);
         newStr += ' '.repeat(indentLevel * indentSize) + currentToken.trim() + ',\n';
         console.log(`string after adding this param (indent level ${indentLevel}):`, newStr);
         currentToken = '';
      } else {
         currentToken += char;
      }
   }
}

function convertToDestructuredObjectInput() {
   const editor = vscode.window.activeTextEditor;
   if (!editor) {
      return 'Editor is not opening.';
   }
   const document = editor.document;
   const selection = editor.selection;
   const text = document.getText(selection);

   const vars = text.split(',');

   let args = '{ ';
   let argType = '{ '

   vars.forEach((v, varIndex) => {
      const [name, type] = v.split(':').map(s => s.trim());
      if (varIndex > 0) {
         args += ', ';
         argType += ', ';
      }
      args += name;
      argType += `${name}: ${type}`;
   })

   args += ' }';
   argType += ' }';

   editor.edit(editBuilder => {
      editBuilder.replace(selection, `${args}: ${argType}`);
   });
}

function getLineIndentLevel(line, indentSize) {
   const leadingSpaces = line.length - line.trimStart().length;
   const indentLevel = leadingSpaces / indentSize;
   console.log('leading spaces', leadingSpaces, 'level', indentLevel);

   return indentLevel;
}

function changeStringChar(replaceWith) {
    const searchFor = replaceWith === '`' ? "'" : '`';
    const editor = vscode.window.activeTextEditor;
   if (!editor) {
      return 'Editor is not opening.';
   }
   const document = editor.document;
   const selection = editor.selection;
   const selectedLine = document.lineAt(selection.start.line).text;
   const cursorIndex = selection.start.character;

   console.log('selected line:', selectedLine);
   const quoteStart = selectedLine.lastIndexOf(searchFor, cursorIndex - 1);
   const quoteEnd = selectedLine.indexOf(searchFor, cursorIndex);

   console.log('quoteStart, quoteEnd:', quoteStart, quoteEnd);

   if (quoteStart === -1 || quoteEnd === -1) {
        return;
    }

    const lineSelection = new vscode.Selection(selection.start.line, 0, selection.start.line, selectedLine.length);

    const newLine = selectedLine.substring(0, quoteStart) + replaceWith + selectedLine.substring(quoteStart + 1, quoteEnd) + replaceWith + selectedLine.substring(quoteEnd + 1);
    editor.edit(editBuilder => {
        editBuilder.replace(lineSelection, newLine);
    });
}