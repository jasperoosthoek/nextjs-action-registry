# @jasperoosthoek/nextjs-action-registry — dev tasks
# Run `just` to list recipes.

port := "3939"

# List available recipes
default:
    @just --list

# Install the spike's standalone deps (Next/React/Tailwind — isolated from the library's own package.json)
spike-install:
    @cd spike && npm install

# Run the spike app (dev server) → http://localhost:{{port}}
spike port=port:
    @cd spike && PORT={{port}} npm run dev

# Build the spike (the server-action registration check)
spike-build:
    @cd spike && npm run build

# Typecheck the spike (its own tsconfig.json — separate from the library's)
spike-typecheck:
    @cd spike && npm run typecheck

# Run unit + type tests
test:
    @npm test

test-coverage:
    @npm test -- --coverage

# Run the spike production build (alias for spike-build)
test-spike:
    @just spike-build

# Typecheck the library
typecheck:
    @npm run typecheck

# Build the library (emit dist/)
build:
    @npm run build
