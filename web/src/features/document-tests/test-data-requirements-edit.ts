export type TestDataRequirement = {
    key: string;
    description: string;
    source?: string;
    required: boolean;
};
export function applyTestDataRequirementsEdit<T extends {
    reviewStatus?: string;
    cases: Array<Record<string, unknown>>;
}>(project: T, index: number, requirements: TestDataRequirement[]): T {
    const cases = project.cases.map((item, i) => i === index ? { ...item, testDataRequirements: requirements, lifecycleStatus: 'draft', selectedForRegression: false } : item);
    return { ...project, cases, reviewStatus: 'draft' } as T;
}
