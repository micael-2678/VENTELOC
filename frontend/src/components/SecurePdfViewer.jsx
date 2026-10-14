import { useState, useEffect, useRef } from 'react';
import { Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as pdfjsLib from 'pdfjs-dist';

// Worker pdf.js embarqué (SPEC §7.6) : le fichier est copié par webpack dans build/static/media et servi par
// l'application elle-même. Aucun CDN : le dossier du bien fonctionne sans requête vers un tiers.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();

// Props : base64Content (PDF encodé), watermark (texte du filigrane) ; `filename` passé par les pages est ignoré ici.
const SecurePdfViewer = ({ base64Content, watermark }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(1.2);
  const [error, setError] = useState(null);
  const renderTaskRef = useRef(null);

  // Load PDF
  useEffect(() => {
    const loadPdf = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Convert base64 to Uint8Array
        const binaryString = atob(base64Content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        const pdf = await loadingTask.promise;
        
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
        setPageNum(1);
      } catch (err) {
        console.error('Error loading PDF:', err);
        setError('Erreur lors du chargement du PDF');
      } finally {
        setLoading(false);
      }
    };

    if (base64Content) {
      loadPdf();
    }
  }, [base64Content]);

  // Render page
  useEffect(() => {
    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current) return;

      try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };
        
        // Annuler le rendu précédent (changement rapide de page/zoom)
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }
        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (renderTaskRef.current !== renderTask) return;
        renderTaskRef.current = null;
        
        // Draw watermark
        if (watermark) {
          context.save();
          context.globalAlpha = 0.15;
          context.font = '24px Arial';
          context.fillStyle = '#000000';
          context.translate(canvas.width / 2, canvas.height / 2);
          context.rotate(-Math.PI / 6);
          
          // Draw watermark multiple times for coverage
          const watermarkText = watermark;
          const textWidth = context.measureText(watermarkText).width;
          
          for (let y = -canvas.height; y < canvas.height * 2; y += 150) {
            for (let x = -canvas.width; x < canvas.width * 2; x += textWidth + 100) {
              context.fillText(watermarkText, x - canvas.width / 2, y - canvas.height / 2);
            }
          }
          
          context.restore();
        }
      } catch (err) {
        if (err?.name === 'RenderingCancelledException') return;
        console.error('Error rendering page:', err);
      }
    };

    renderPage();

    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, pageNum, scale, watermark]);

  const goToPrevPage = () => {
    if (pageNum > 1) {
      setPageNum(pageNum - 1);
    }
  };

  const goToNextPage = () => {
    if (pageNum < numPages) {
      setPageNum(pageNum + 1);
    }
  };

  const zoomIn = () => {
    setScale(prev => Math.min(prev + 0.2, 3));
  };

  const zoomOut = () => {
    setScale(prev => Math.max(prev - 0.2, 0.5));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Chargement du document...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="flex flex-col h-full select-none"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
    >
      {/* Controls */}
      <div className="flex items-center justify-center gap-4 p-2 bg-gray-200 rounded-t-lg">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={goToPrevPage}
            disabled={pageNum <= 1}
            className="rounded-lg"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium">
            Page {pageNum} / {numPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={goToNextPage}
            disabled={pageNum >= numPages}
            className="rounded-lg"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="flex items-center gap-2 border-l pl-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={zoomOut}
            disabled={scale <= 0.5}
            className="rounded-lg"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-sm w-16 text-center">{Math.round(scale * 100)}%</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={zoomIn}
            disabled={scale >= 3}
            className="rounded-lg"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      {/* Canvas container */}
      <div className="flex-1 overflow-auto bg-gray-300 p-4 flex justify-center">
        <canvas 
          ref={canvasRef}
          className="shadow-lg"
          style={{ 
            pointerEvents: 'none',
            maxWidth: '100%',
            height: 'auto'
          }}
        />
      </div>
    </div>
  );
};

export default SecurePdfViewer;
