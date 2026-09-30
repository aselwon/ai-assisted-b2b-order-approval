module.exports = {
  transform: {
    "^.+\\.[jt]s$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          target: "es2021",
        },
      },
    ],
  },
  testEnvironment: "node",
  testMatch: ["**/integration-tests/**/*.spec.ts"],
  modulePathIgnorePatterns: [".medusa/"],
  setupFiles: ["./integration-tests/setup.js"],
};
