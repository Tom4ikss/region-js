# d8 with the regions patch, the tests and the documentation examples.
# Built by .github/workflows/d8.yml from the packaged d8 in dist/region-js-d8.
#
#   docker run --rm -it ghcr.io/tom4ikss/region-js                     # REPL
#   docker run --rm ghcr.io/tom4ikss/region-js examples/en/10-spawn-basic.js
#   docker run --rm -v "$PWD:/work" -w /work ghcr.io/tom4ikss/region-js --module main.js
FROM debian:bookworm-slim
COPY dist/region-js-d8/ /opt/region-js/
COPY tests/ /opt/region-js/tests/
COPY site/examples/ /opt/region-js/examples/
RUN useradd --create-home region
USER region
WORKDIR /opt/region-js
ENTRYPOINT ["/opt/region-js/d8", "--harmony-regions"]
