PREFIX ?= $(HOME)/.local
BIN_DIR ?= $(PREFIX)/bin

.PHONY: install-local test

install-local:
	PREFIX="$(PREFIX)" BIN_DIR="$(BIN_DIR)" npm run install-local

test:
	npm test
