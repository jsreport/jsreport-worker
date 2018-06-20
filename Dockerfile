FROM ubuntu:xenial
# not using ubuntu:bionic because phantomjs 1.9.8 does not work there
# (it contains a newer version of OpenSSL which can not be used with phantomjs)

RUN adduser --disabled-password --gecos "" jsreport && \
    apt-get update && \
    apt-get install -y --no-install-recommends libgconf-2-4 gnupg git curl wget ca-certificates && \
    # chrome needs some base fonts
    apt-get install -y --no-install-recommends xfonts-base xfonts-75dpi && \
    # node
    curl -sL https://deb.nodesource.com/setup_8.x | bash - && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    npm i -g npm && \
    # chrome
    apt-get install -y libgconf-2-4 && \
    wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
    apt-get update && \
    apt-get install -y google-chrome-unstable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst --no-install-recommends && \
    # cleanup
    rm -rf /var/lib/apt/lists/* /var/cache/apt/* && \
    rm -rf /src/*.deb

RUN mkdir -p /app
WORKDIR /app

COPY package.json /app/package.json

# the chrome was already installed from apt-get
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true

RUN npm install && \
    npm cache clean -f && \
    rm -rf /tmp/*

COPY . /app

EXPOSE 2000

ENV NODE_ENV production
ENV templatingEngines_strategy http-server
ENV chrome_launchOptions_executablePath google-chrome-unstable
ENV chrome_launchOptions_args --no-sandbox

CMD ["node", "server.js"]
