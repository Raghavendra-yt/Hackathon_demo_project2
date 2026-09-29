import '@testing-library/jest-dom';

// Mock scrollIntoView for tests since jsdom doesn't support it
window.HTMLElement.prototype.scrollIntoView = function() {};
