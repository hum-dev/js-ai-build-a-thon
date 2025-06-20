const changes = await git.diff({ staged: true });

// Option 1: Compare staged changes with empty string (to show what's being added)
defDiff("CODE_CHANGES", "", changes);

// Option 2: Compare staged changes with HEAD (more common for code reviews)
// const headContent = await git.diff({ staged: false });
// defDiff("CODE_CHANGES", headContent, changes);

// Option 3: If you have specific files to compare
// const oldFile = await workspace.readText("path/to/file");
// const newFile = await workspace.readText("path/to/modified/file");
// defDiff("CODE_CHANGES", oldFile, newFile);

$`## Role
You are a senior developer whose job is to review code changes and provide meaningful feedback.

## Task
Review <CODE_CHANGES>, point out possible mistakes or bad practices, and provide suggestions for improvement.
- Be specific about what's wrong and why it's wrong
- Reference proper coding standards and best practices
- Be brief to get your point across
`;