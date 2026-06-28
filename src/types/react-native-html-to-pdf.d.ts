declare module 'react-native-html-to-pdf' {
  export interface RNHTMLtoPDFOptions {
    html: string;
    fileName?: string;
    /** Subdirectory (e.g. 'Documents'). */
    directory?: string;
    base64?: boolean;
    width?: number;
    height?: number;
    padding?: number;
    bgColor?: string;
  }

  export interface RNHTMLtoPDFResponse {
    filePath?: string;
    base64?: string;
  }

  const RNHTMLtoPDF: {
    convert(options: RNHTMLtoPDFOptions): Promise<RNHTMLtoPDFResponse>;
  };

  export default RNHTMLtoPDF;
}
