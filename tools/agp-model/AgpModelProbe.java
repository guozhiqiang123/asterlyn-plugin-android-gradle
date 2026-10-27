import com.android.builder.model.v2.ide.*;
import com.android.builder.model.v2.models.*;
import com.google.gson.Gson;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.gradle.tooling.*;
import org.gradle.tooling.model.gradle.*;

/** Development probe only; product execution requires the host auxiliary-job boundary. */
public class AgpModelProbe {
    public static class Action implements BuildAction<Map<String, Object>>, Serializable {
        private static final long serialVersionUID = 1L;
        private final String module;
        private final String selectedVariant;

        public Action(String module, String selectedVariant) {
            this.module = module;
            this.selectedVariant = selectedVariant;
        }

        @Override
        public Map<String, Object> execute(BuildController controller) {
            System.err.println("MODEL_STAGE build-model");
            Map<String, Object> result = new LinkedHashMap<>();
            for (BasicGradleProject project : controller.getBuildModel().getProjects()) {
                if (!project.getPath().equals(module)) continue;
                System.err.println("MODEL_STAGE basic-model");
                BasicAndroidProject basic = controller.getModel(project, BasicAndroidProject.class);
                BasicVariant variant = basic.getVariants().stream()
                    .filter(value -> value.getName().equals(selectedVariant))
                    .findFirst().orElseThrow(() -> new IllegalArgumentException("selected-variant-model-missing"));
                Map<String, Object> model = new LinkedHashMap<>();
                result.put(project.getPath(), model);
                model.put("directory", project.getProjectDirectory().getAbsolutePath());
                model.put("variant", variant.getName());
                List<SourceProvider> providers = new ArrayList<>();
                if (basic.getMainSourceSet() != null) providers.add(basic.getMainSourceSet().getSourceProvider());
                for (SourceSetContainer source : basic.getBuildTypeSourceSets()) {
                    if (source.getSourceProvider() != null
                        && source.getSourceProvider().getName().equals(variant.getBuildType())) {
                        providers.add(source.getSourceProvider());
                    }
                }
                for (SourceSetContainer source : basic.getProductFlavorSourceSets()) {
                    if (source.getSourceProvider() != null
                        && variant.getProductFlavors().contains(source.getSourceProvider().getName())) {
                        providers.add(source.getSourceProvider());
                    }
                }
                providers.add(variant.getMainArtifact().getVariantSourceProvider());
                providers.add(variant.getMainArtifact().getMultiFlavorSourceProvider());
                Set<String> sources = new LinkedHashSet<>();
                for (SourceProvider provider : providers) {
                    if (provider == null) continue;
                    for (File file : provider.getJavaDirectories()) sources.add(file.getAbsolutePath());
                    for (File file : provider.getKotlinDirectories()) sources.add(file.getAbsolutePath());
                }
                model.put("sources", sources);
                model.put("bootClasspath", basic.getBootClasspath().stream().map(File::getAbsolutePath).toList());
                System.err.println("MODEL_STAGE variant-dependencies");
                VariantDependencies dependencies = controller.getModel(
                    project, VariantDependencies.class, ModelBuilderParameter.class, parameter -> {
                        parameter.setVariantName(variant.getName());
                        parameter.setDontBuildRuntimeClasspath(true);
                        parameter.setDontBuildUnitTestRuntimeClasspath(true);
                        parameter.setDontBuildAndroidTestRuntimeClasspath(true);
                        parameter.setDontBuildScreenshotTestRuntimeClasspath(true);
                        parameter.setDontBuildTestFixtureRuntimeClasspath(true);
                        parameter.setDontBuildHostTestRuntimeClasspath(Map.of());
                        parameter.setAdditionalArtifactsInModel(false);
                    });
                Set<String> keys = new LinkedHashSet<>();
                for (GraphItem item : dependencies.getMainArtifact().getCompileDependencies()) visit(item, keys);
                Set<String> classpath = new LinkedHashSet<>();
                Set<String> projectDependencies = new LinkedHashSet<>();
                for (String key : keys) {
                    Library library = dependencies.getLibraries().get(key);
                    if (library == null) throw new IllegalStateException("dependency-library-model-missing");
                    if (library.getAndroidLibraryData() != null) {
                        for (File file : library.getAndroidLibraryData().getCompileJarFiles()) {
                            classpath.add(file.getAbsolutePath());
                        }
                    } else if (library.getArtifact() != null) {
                        classpath.add(library.getArtifact().getAbsolutePath());
                    }
                    if (library.getProjectInfo() != null) projectDependencies.add(library.getProjectInfo().getProjectPath());
                }
                System.err.println("MODEL_STAGE serialize");
                model.put("compileClasspath", classpath);
                model.put("projectDependencies", projectDependencies);
                model.put("unresolvedCount", dependencies.getMainArtifact().getUnresolvedDependencies().size());
            }
            if (result.isEmpty()) throw new IllegalArgumentException("selected-module-model-missing");
            return result;
        }

        private void visit(GraphItem item, Set<String> seen) {
            if (seen.add(item.getKey())) for (GraphItem dependency : item.getDependencies()) visit(dependency, seen);
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 7) throw new IllegalArgumentException("expected-seven-probe-arguments");
        GradleConnector connector = GradleConnector.newConnector()
            .forProjectDirectory(new File(args[0]))
            .useGradleUserHomeDir(new File(args[1]))
            .useInstallation(new File(args[4]));
        CancellationTokenSource cancellation = GradleConnector.newCancellationTokenSource();
        Thread cancelHook = new Thread(cancellation::cancel);
        Runtime.getRuntime().addShutdownHook(cancelHook);
        try (ProjectConnection connection = connector.connect()) {
            Map<String, Object> result = connection.action(new Action(args[5], args[6]))
                .withCancellationToken(cancellation.token())
                .setJavaHome(new File(args[2]))
                .withArguments("--offline", "-Dorg.gradle.configureondemand=false",
                    "-Pandroid.injected.invoked.from.ide=true")
                .setStandardOutput(OutputStream.nullOutputStream())
                .setStandardError(System.err)
                .addProgressListener((org.gradle.tooling.ProgressListener) event ->
                    System.err.println("MODEL_PROGRESS " + event.getDescription()))
                .run();
            Files.writeString(Path.of(args[3]), new Gson().toJson(result));
            System.out.println("AGP model modules=" + result.size());
        } finally {
            try { Runtime.getRuntime().removeShutdownHook(cancelHook); }
            catch (IllegalStateException ignored) { }
            connector.disconnect();
        }
    }
}
