# @jasperoosthoek/nextjs-action-registry — dev tasks
# Run `just` to list recipes.

port := "3939"

# List available recipes
default:
    @just --list

# Run the spike app (dev server) → http://localhost:{{port}}
spike port=port:
    @cd spike && PORT={{port}} ../node_modules/.bin/next dev

# Build the spike (the server-action registration check)
spike-build:
    @cd spike && ../node_modules/.bin/next build

# Run unit + type tests
test:
    @npm test

test-coverage:
    @npm test -- --coverage

# Run the spike app production build through npm
test-spike:
    @npm run test-spike

# Typecheck the library
typecheck:
    @npm run typecheck

# Build the library (emit dist/)
build:
    @npm run build
