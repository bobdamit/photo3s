# Use AWS Lambda Node.js 20 runtime
FROM public.ecr.aws/lambda/nodejs:20

# Copy package files first
COPY package*.json ${LAMBDA_TASK_ROOT}/

# Set npm configuration to prefer prebuilt binaries for Sharp
# This avoids needing to compile Sharp from source
ENV npm_config_sharp_binary_host="https://github.com/lovell/sharp-libvips/releases/download"
ENV npm_config_sharp_libvips_binary_host="https://github.com/lovell/sharp-libvips/releases/download"

# Install Node.js dependencies
RUN npm ci --only=production --no-audit --no-fund

# Copy Lambda function code
COPY handler/src/upload-lambda.js ${LAMBDA_TASK_ROOT}/

# Set the CMD to your handler
CMD [ "upload-lambda.handler" ]