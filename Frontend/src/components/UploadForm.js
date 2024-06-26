import React, { useState } from 'react';
import axios from 'axios';

const UploadForm = () => {
    const [inputText, setInputText] = useState('');
    const [file, setFile] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!file) {
            alert('Please select a file.');
            return;
        }

        try {

            const presignedUrlResponse = await axios.post("https://r6bt88y1d7.execute-api.ap-south-1.amazonaws.com/prod/presigned-url", {
                key: `user1/${file.name}`
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });


            const presignedUrlData = presignedUrlResponse.data;

            const presignedUrl = presignedUrlData.url;

            // Upload the file to S3 using the presigned URL
            await axios.put(presignedUrl, file, {
                headers: {
                    'Content-Type': file.type,
                }
            });

            // Send metadata to API Gateway
            const response = await axios.post(process.env.REACT_APP_API_GATEWAY_URL, {
                inputText: inputText,
                inputFile: `user1/${file.name}`
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            alert('File uploaded and metadata stored successfully.');

        } catch (error) {
            console.error('Error uploading file or storing metadata:', error);
            alert('Operation failed.');
        }
    };


    return (
        <form onSubmit={handleSubmit} className="p-4 space-y-4 bg-white rounded-lg shadow-md">
            <div>
                <label className="block text-sm font-medium text-gray-700">Text</label>
                <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    className="block w-full px-3 py-2 mt-1 text-base border rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700">File</label>
                <input
                    type="file"
                    onChange={(e) => setFile(e.target.files[0])}
                    className="block w-full px-3 py-2 mt-1 text-base border rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
            </div>
            <button
                type="submit"
                className="px-4 py-2 text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
            >
                Upload
            </button>
        </form>
    );
};

export default UploadForm;
