import { parseAskUserQuestionInput } from '../shared/askUserQuestion';

describe('parseAskUserQuestionInput', () => {
  const validInput = {
    questions: [
      {
        question: 'Which library?',
        header: 'Library',
        options: [
          { label: 'date-fns', description: 'Lightweight' },
          { label: 'moment', description: 'Legacy' },
        ],
        multiSelect: false,
      },
    ],
  };

  it('parses a well-formed single question', () => {
    expect(parseAskUserQuestionInput(validInput)).toEqual(validInput.questions);
  });

  it('parses multiple questions, including one with an optional preview field', () => {
    const input = {
      questions: [
        ...validInput.questions,
        {
          question: 'Which layout?',
          header: 'Layout',
          options: [
            { label: 'Compact', description: 'Dense', preview: '<div>compact</div>' },
            { label: 'Spacious', description: 'Airy' },
          ],
          multiSelect: true,
        },
      ],
    };
    const parsed = parseAskUserQuestionInput(input);
    expect(parsed).toHaveLength(2);
    expect(parsed?.[1].options[0].preview).toBe('<div>compact</div>');
  });

  it('returns null for input that is not an object', () => {
    expect(parseAskUserQuestionInput(null)).toBeNull();
    expect(parseAskUserQuestionInput('nope')).toBeNull();
    expect(parseAskUserQuestionInput(42)).toBeNull();
  });

  it('returns null when questions is missing or not an array', () => {
    expect(parseAskUserQuestionInput({})).toBeNull();
    expect(parseAskUserQuestionInput({ questions: 'nope' })).toBeNull();
  });

  it('returns null when questions is an empty array', () => {
    expect(parseAskUserQuestionInput({ questions: [] })).toBeNull();
  });

  it('returns null when a question is missing a required field', () => {
    const input = {
      questions: [
        {
          question: 'Which library?',
          header: 'Library',
          // multiSelect missing
          options: [
            { label: 'date-fns', description: 'Lightweight' },
            { label: 'moment', description: 'Legacy' },
          ],
        },
      ],
    };
    expect(parseAskUserQuestionInput(input)).toBeNull();
  });

  it('returns null when a question has fewer than 2 options', () => {
    const input = {
      questions: [
        {
          question: 'Which library?',
          header: 'Library',
          options: [{ label: 'date-fns', description: 'Lightweight' }],
          multiSelect: false,
        },
      ],
    };
    expect(parseAskUserQuestionInput(input)).toBeNull();
  });

  it('returns null when an option is missing a required field', () => {
    const input = {
      questions: [
        {
          question: 'Which library?',
          header: 'Library',
          options: [{ label: 'date-fns' }, { label: 'moment', description: 'Legacy' }],
          multiSelect: false,
        },
      ],
    };
    expect(parseAskUserQuestionInput(input)).toBeNull();
  });
});
