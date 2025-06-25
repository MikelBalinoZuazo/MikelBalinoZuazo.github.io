// Variable para la instancia de rhino3dm
let rhino;
// Variables para el motor y la escena de Babylon.js
let engine;
let scene;
let camera; // Hacemos la cámara global para poder acceder a ella desde resetCameraView

// Variables para guardar la posición inicial de la cámara
let initialCameraAlpha;
let initialCameraBeta;
let initialCameraRadius;
let initialCameraTarget;

// --- Funciones de Inicialización ---

async function initializeRhino3dm() {
    // Carga asíncrona de rhino3dm.js
    rhino = await rhino3dm();
    console.log('rhino3dm.js cargado y listo.');
    // Una vez que rhino3dm está listo, inicializamos Babylon.js
    createBabylonScene();
}

function createBabylonScene() {
    const canvas = document.getElementById('renderCanvas');
    if (!canvas) {
        console.error('El elemento canvas con ID "renderCanvas" no se encontró.');
        return;
    }
    engine = new BABYLON.Engine(canvas, true); // true para antialiasing
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color3(0.8, 0.8, 0.8); // Fondo gris claro

    // Configuración de la cámara (ArcRotateCamera es ideal para visores)
    camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 2, Math.PI / 2.5, 10, BABYLON.Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.wheelPrecision = 50; // Ajusta la sensibilidad del zoom

    // Guarda la posición inicial de la cámara
    initialCameraAlpha = camera.alpha;
    initialCameraBeta = camera.beta;
    initialCameraRadius = camera.radius;
    initialCameraTarget = camera.target.clone();

    // Configuración de la luz
    const light = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), scene);
    light.intensity = 0.7;

    // Aquí llamaremos a la función para cargar tu modelo 3dm
    // ¡IMPORTANTE!: Asegúrate de que esta ruta coincida con el nombre del archivo renombrado.
    loadRhinoModel('models/modelo.3dm', scene); // RUTA ACTUALIZADA

    // Bucle de renderizado de Babylon.js
    engine.runRenderLoop(() => {
        scene.render();
    });

    // Manejar el redimensionamiento de la ventana
    window.addEventListener('resize', () => {
        engine.resize();
    });
}

// Función global para reiniciar la vista de la cámara
// Esta función es llamada desde el index.html
window.resetCameraView = function() {
    if (camera) {
        camera.setTarget(initialCameraTarget.clone()); // Usar un clon para no modificar el original
        camera.alpha = initialCameraAlpha;
        camera.beta = initialCameraBeta;
        camera.radius = initialCameraRadius;
    }
};

// --- Funciones de Carga y Conversión de Modelo ---

async function loadRhinoModel(url, scene) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Error al cargar el archivo: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        const arr = new Uint8Array(buffer);
        const doc = rhino.File3dm.decode(arr);

        if (!doc) {
            console.error('No se pudo decodificar el archivo .3dm');
            return;
        }

        console.log('Archivo .3dm cargado. Procesando geometría...');

        // Itera sobre los objetos del documento .3dm
        for (let i = 0; i < doc.objects().count; i++) {
            const rhinoObject = doc.objects().get(i);
            const geometry = rhinoObject.geometry();

            // Intenta obtener el material del objeto de Rhino
            let babylonMaterial = null;
            if (rhinoObject.attributes().materialSource === rhino.ObjectMaterialSource.MaterialFromObject) {
                const matIndex = rhinoObject.attributes().materialIndex;
                if (matIndex !== -1) {
                    const rhinoMaterial = doc.materials().get(matIndex);
                    if (rhinoMaterial) {
                        babylonMaterial = new BABYLON.PBRMaterial("rhinoMat_" + i, scene);
                        // Convertir color RGBA de Rhino (0-255) a Babylon.js (0-1)
                        babylonMaterial.albedoColor = new BABYLON.Color3(
                            rhinoMaterial.ambientColor.r / 255,
                            rhinoMaterial.ambientColor.g / 255,
                            rhinoMaterial.ambientColor.b / 255
                        );
                        babylonMaterial.alpha = rhinoMaterial.transparency; // Asumiendo transparencia de Rhino es 0-1
                        babylonMaterial.roughness = rhinoMaterial.roughness; // Si el material de Rhino tiene rugosidad
                        babylonMaterial.metallic = rhinoMaterial.metallic;   // Si el material de Rhino tiene metalicidad
                        // Puedes mapear más propiedades de material aquí si las necesitas
                    }
                }
            }
            // Material por defecto si no hay material de Rhino o falla la obtención
            if (!babylonMaterial) {
                 babylonMaterial = new BABYLON.StandardMaterial("defaultMat_" + i, scene);
                 babylonMaterial.diffuseColor = new BABYLON.Color3(0.7, 0.7, 0.7); // Gris por defecto
            }


            // --- Convertir diferentes tipos de geometría a mallas de Babylon.js ---
            if (geometry instanceof rhino.Mesh) {
                // Si la geometría ya es una malla, la convertimos directamente
                const babylonMesh = createBabylonMeshFromRhinoMesh(geometry, "rhinoMesh_" + i, scene);
                if (babylonMesh) {
                    babylonMesh.material = babylonMaterial;
                }
            } else if (geometry instanceof rhino.Brep || geometry instanceof rhino.Extrusion || geometry instanceof rhino.SubD) {
                // Para Breps, Extrusiones o SubD, necesitamos teselarlos a una malla
                const meshingParameters = new rhino.MeshingParameters();
                meshingParameters.set(rhino.MeshingParameters.FastRenderMesh); // Un buen equilibrio entre calidad y rendimiento

                // Crea mallas a partir de la geometría
                const meshes = rhino.Mesh.createFromBrep(geometry, meshingParameters);
                if (meshes) {
                    for (const m of meshes) {
                        const babylonMesh = createBabylonMeshFromRhinoMesh(m, "rhinoPartMesh_" + i, scene);
                        if (babylonMesh) {
                            babylonMesh.material = babylonMaterial;
                        }
                        m.delete(); // CRÍTICO: Libera la memoria de la malla de Rhino
                    }
                }
            } else if (geometry instanceof rhino.Curve) {
                // Las curvas se pueden visualizar como líneas
                // Divide la curva en puntos equidistantes
                const points = geometry.divideEquidistant(0.1); // 0.1 es el espaciado entre puntos
                if (points && points.length > 1) {
                    const babylonPoints = points.map(p => new BABYLON.Vector3(p.x, p.y, p.z));
                    const line = BABYLON.MeshBuilder.CreateLines("curveLine_" + i, { points: babylonPoints }, scene);
                    // Las líneas no usan materiales PBR directamente, así que usamos un color simple
                    // Si el material tiene color difuso, úsalo, si no, por defecto negro
                    line.color = babylonMaterial.diffuseColor || new BABYLON.Color3(0, 0, 0);
                }
            }
            // Agrega más 'else if' para otros tipos de geometría de Rhino si los necesitas (ej. rhino.Point)

            // CRÍTICO: Libera la memoria de los objetos rhino3dm una vez que los hayas procesado
            geometry.delete();
            rhinoObject.delete();
        }

        // CRÍTICO: Libera la memoria del documento .3dm completo
        doc.delete();
        console.log('Modelo Rhino cargado exitosamente en Babylon.js.');

    } catch (error) {
        console.error('Error al cargar o procesar el modelo 3dm:', error);
    }
}

// Función auxiliar para convertir una malla de rhino3dm a una malla de Babylon.js
function createBabylonMeshFromRhinoMesh(rhinoMesh, name, scene) {
    if (!rhinoMesh || !rhinoMesh.vertices || rhinoMesh.vertices().count === 0) {
        return null;
    }

    const positions = rhinoMesh.vertices().toFloatArray();
    const normals = rhinoMesh.normals().toFloatArray(); // Rhino puede exportar normales, si no, se pueden computar
    const indices = rhinoMesh.faces().toArray();

    // Las caras de Rhino pueden ser triángulos o cuádruples. Babylon.js usa solo triángulos.
    // Necesitamos expandir los cuádruples a dos triángulos.
    const finalIndices = [];
    for (let i = 0; i < indices.length; i += 4) {
        finalIndices.push(indices[i], indices[i+1], indices[i+2]); // Primer triángulo
        if (indices[i+3] !== -1) { // Si es un cuádruple (el cuarto índice no es -1)
            finalIndices.push(indices[i], indices[i+2], indices[i+3]); // Segundo triángulo
        }
    }

    const babylonMesh = new BABYLON.Mesh(name, scene);
    const vertexData = new BABYLON.VertexData();

    vertexData.positions = positions;
    vertexData.indices = finalIndices;

    // Si rhinoMesh tiene normales, úsalas. De lo contrario, Babylon.js puede computarlas.
    if (normals.length > 0 && normals.length === positions.length) {
        vertexData.normals = normals;
    } else {
        // Si no hay normales precalculadas o no coinciden, Babylon.js puede generarlas
        BABYLON.VertexData.ComputeNormals(positions, finalIndices, normals); // 'normals' aquí es un array temporal para el cálculo
        vertexData.normals = normals;
    }

    vertexData.applyToMesh(babylonMesh);

    return babylonMesh;
}

// --- Iniciar la aplicación ---
// Inicia el proceso cargando rhino3dm.js
initializeRhino3dm();
