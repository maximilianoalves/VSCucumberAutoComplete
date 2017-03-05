import ElementsHandler, { Element } from './elements.handler';
import { getOSPath, getFileContent, clearComments, getId } from '../util';
import {
    Definition,
    CompletionItem,
    Diagnostic,
    DiagnosticSeverity,
    Position,
    Location,
    Range,
    CompletionItemKind
} from 'vscode-languageserver';

import * as glob from 'glob';

export type StepSettings = string[];

export default class StepsHandler extends ElementsHandler<StepSettings> {

    constructor(stepsPathes: StepSettings) {
        super(stepsPathes);
    }

    private getStepRegExp() {

        //Actually, we dont care what the symbols are before our 'Gherkin' word
        let startPart = '^(.*)';

        //All the steps should be declared using Given, When or Then keyword
        let gherkinPart = '(Given|When|Then)';

        //All the symbols, except of symbols, using as step start could be between gherkin word and our step
        let nonStepStartSymbols = '[^\'|^"|^\\/]*';

        //Step text could be placed between '/' symbols (ex. in JS) or between quotes, like in Java
        let stepStart = `('|"|\\/)`;

        //Our step could contain any symbols, except of our 'stepStart'. Use \3 to be sure in this
        let stepBody = '([^\\3]+)';

        //Step should be ended with same symbol it begins
        let stepEnd = '\\3';

        //Our RegExp will be case-insensitive to support cases like TypeScript (...@when...)
        let r = new RegExp(startPart + gherkinPart + nonStepStartSymbols + stepStart + stepBody + stepEnd, 'i');

        return r;

    }

    private getSteps(filePath: string): Element[] {
        let steps = [];
        let definitionFile = getFileContent(filePath);
        definitionFile = clearComments(definitionFile);
        let stepRegExp = this.getStepRegExp();
        definitionFile.split(/\r?\n/g).forEach((line, lineIndex) => {
            let match = line.match(stepRegExp);
            if (match) {
                let beforeGherkin = match[1];
                let stepText = match[4];
                let pos = Position.create(lineIndex, beforeGherkin.length);
                steps.push({
                    id: 'step' + getId(),
                    reg: new RegExp(stepText),
                    //We should remove text between quotes, '^|$' regexp marks and backslashes
                    text: stepText.replace(/^\^|\$$/g, '').replace(/"\([^\)]*\)"/g, '""').replace(/\\/g, ''),
                    desc: line.replace(/\{.*/, '').replace(/^\s*/, '').replace(/\s*$/, ''),
                    def: Location.create(getOSPath(filePath), Range.create(pos, pos))
                });
            }
        });
        return steps;
    }

    populate(stepsPathes: StepSettings) {
        let stepsFiles = [];
        this.elements = [];
        stepsPathes.forEach((path) => {
            glob.sync(path, { ignore: '.gitignore' }).forEach(f => {
                stepsFiles.push(f);
            });
        });
        stepsFiles.forEach(f => {
            this.elements = this.elements.concat(this.getSteps(f));
        });
    }

    private gherkinRegEx = /^(\s*)(Given|When|Then|And|But)(.)(.*)/;

    private getStepByText(text) {
        return this.elements.find(s => { return s.reg.test(text); });
    }

    validate(line: string, lineNum: number): Diagnostic | null {
        let match = line.match(this.gherkinRegEx);
        if (!match) {
            return null;
        }
        let beforeGherkin = match[1];
        let step = this.getStepByText(match[4]);
        if (step) {
            return null;
        } else {
            return {
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: { line: lineNum, character: beforeGherkin.length },
                    end: { line: lineNum, character: line.length }
                },
                message: `Was unable to find step for "${line}"`,
                source: 'ex'
            };
        }
    }

    getDefinition(line: string, char: number): Definition | null {
        let match = line.match(this.gherkinRegEx);
        let step = this.getStepByText(match[4]);
        return step ? step.def : null;
    }

    getCompletion(line: string, char: number): CompletionItem[] | void {
        //Get line part without gherkin (Given When Then)
        let stepPart = line.replace(this.gherkinRegEx, '');
        //Return all the braces into default state
        stepPart = stepPart.replace(/"[^"]*"/g, '""');
        //We should not obtain last word
        stepPart = stepPart.replace(/[^\s]+$/, '');
        //We should replace/search only string beginning
        let stepPartRe = new RegExp('^' + stepPart);
        return this.elements
            .filter(el => {
                return el.text.search(stepPartRe) !== -1;
            })
            .map(step => {
                return {
                    label: step.text.replace(stepPartRe, ''),
                    kind: CompletionItemKind.Function,
                    data: step.id
                };
            });
    }

    getCompletionResolve(item: CompletionItem): CompletionItem[] {
        return [item];
    };

}